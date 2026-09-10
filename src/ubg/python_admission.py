"""Bounded dependency-admission projection. Parse target source; never execute it."""
import ast
import hashlib
import json
import sys


def project(source, requested):
    tree = ast.parse(source)
    if len(source.encode('utf8')) > 1048576 or sum(1 for _ in ast.walk(tree)) > 20000:
        raise ValueError('python-source-budget')
    imports, functions, routes = {}, {}, []
    app = None
    occupied = set()
    for node in tree.body:
        names = []
        if isinstance(node, ast.ImportFrom):
            if node.level or any(a.name == '*' for a in node.names):
                raise ValueError('python-import-unmeasured')
            for a in node.names:
                name = a.asname or a.name
                imports[name] = node.module + '.' + a.name
                names.append(name)
        elif isinstance(node, ast.Import):
            names = [a.asname or a.name.split('.')[0] for a in node.names]
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions[node.name] = node
            names = [node.name]
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            call = node.value
            if app or not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or imports.get(call.func.id) != 'fastapi.FastAPI' or call.args or call.keywords:
                raise ValueError('python-registration-unmeasured')
            app = node.targets[0].id
            names = [app]
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        else:
            raise ValueError('python-registration-unmeasured')
        if occupied.intersection(names) or len(names) != len(set(names)):
            raise ValueError('python-binding-reassigned')
        occupied.update(names)
    if not app:
        raise ValueError('python-app-unmeasured')
    used = 0
    lines = source.encode('utf8').splitlines(keepends=True)

    def span(node):
        start = sum(map(len, lines[:node.lineno - 1])) + node.col_offset
        end = sum(map(len, lines[:node.end_lineno - 1])) + node.end_col_offset
        return {'line': node.lineno, 'startByte': start, 'endByte': end}

    def tick(depth):
        nonlocal used
        used += 1
        if used > 512 or depth > 24:
            raise ValueError('python-admission-budget')

    def dep(call):
        if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or imports.get(call.func.id) not in ('fastapi.Depends', 'fastapi.Security') or len(call.args) != 1 or not isinstance(call.args[0], ast.Name):
            raise ValueError('python-dependency-unmeasured')
        for kw in call.keywords:
            if kw.arg == 'use_cache' and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, bool):
                continue
            if kw.arg == 'scopes' and imports[call.func.id] == 'fastapi.Security' and isinstance(kw.value, ast.List) and all(isinstance(x, ast.Constant) and isinstance(x.value, str) for x in kw.value.elts):
                continue
            raise ValueError('python-dependency-options-unmeasured')
        return call.args[0].id

    def parameters(fn):
        args = fn.args
        if args.posonlyargs or args.vararg or args.kwarg:
            raise ValueError('python-parameters-unmeasured')
        pairs = list(zip(args.args, [None] * (len(args.args) - len(args.defaults)) + args.defaults)) + list(zip(args.kwonlyargs, args.kw_defaults))
        requests, dependencies = [], []
        for arg, default in pairs:
            if arg.arg in occupied:
                raise ValueError('python-shadowed-binding')
            if default is not None:
                dependencies.append(dep(default))
            elif isinstance(arg.annotation, ast.Name) and imports.get(arg.annotation.id) == 'fastapi.Request':
                requests.append(arg.arg)
            else:
                raise ValueError('python-parameters-unmeasured')
        return requests, dependencies, {a.arg for a, _ in pairs}

    def dotted(node):
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return dotted(node.value) + '.' + node.attr
        return '?'

    def analyze(name, stack=()):
        tick(len(stack))
        if name in stack or len(stack) > 8 or name not in functions:
            raise ValueError('python-dependency-cycle-or-unresolved')
        fn = functions[name]
        if fn.decorator_list:
            raise ValueError('python-dependency-decorator-unmeasured')
        requests, deps, params = parameters(fn)
        traces = []

        def condition(node, depth):
            tick(depth)
            if isinstance(node, ast.Constant) and isinstance(node.value, bool):
                return node.value
            if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
                return ['not', condition(node.operand, depth + 1)]
            if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
                return ['and' if isinstance(node.op, ast.And) else 'or', *[condition(v, depth + 1) for v in node.values]]
            value = dotted(node)
            for request in requests:
                prefix = request + '.state.'
                field = value[len(prefix):] if value.startswith(prefix) else ''
                if field.isidentifier() and field.isascii() and 0 < len(field) <= 40 and field[0].isalpha():
                    atom = 'state.' + field
                    traces.append({'atom': atom, **span(node)})
                    return atom
            raise ValueError('python-predicate-unmeasured')

        def block(nodes, after, depth):
            tick(depth)
            for node in reversed(nodes):
                tick(depth)
                if isinstance(node, ast.If):
                    test = condition(node.test, depth + 1)
                    yes = block(node.body, after, depth + 1)
                    no = block(node.orelse, after, depth + 1)
                    after = ['or', ['and', test, yes], ['and', ['not', test], no]]
                elif isinstance(node, ast.Raise):
                    call = node.exc
                    if node.cause or not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or imports.get(call.func.id) != 'fastapi.HTTPException':
                        raise ValueError('python-raise-unmeasured')
                    code = call.args[0] if len(call.args) == 1 else next((k.value for k in call.keywords if k.arg == 'status_code'), None) if not call.args else None
                    if not isinstance(code, ast.Constant) or type(code.value) is not int or code.value not in (401, 403) or any(k.arg not in ('status_code', 'detail') or not isinstance(k.value, ast.Constant) for k in call.keywords):
                        raise ValueError('python-exception-unmeasured')
                    after = False
                elif isinstance(node, ast.Return):
                    if node.value is not None and not isinstance(node.value, ast.Constant) and not (isinstance(node.value, ast.Name) and node.value.id in params):
                        raise ValueError('python-return-unmeasured')
                    after = True
                elif isinstance(node, ast.Pass) or isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                    pass
                else:
                    raise ValueError('python-statement-unmeasured')
            return after

        nested = [item for target in deps for item in analyze(target, stack + (name,))]
        formula = block(fn.body, True, 0)  # implicit None completes a dependency successfully
        return nested + [{'name': name, 'formula': formula, 'traces': traces, **span(fn)}]

    for fn in functions.values():
        if not fn.decorator_list:
            continue
        if len(fn.decorator_list) != 1:
            raise ValueError('python-route-decorator-unmeasured')
        call = fn.decorator_list[0]
        if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Attribute) or not isinstance(call.func.value, ast.Name) or call.func.value.id != app or call.func.attr not in ('get', 'post', 'put', 'patch', 'delete', 'head', 'options') or len(call.args) != 1 or not isinstance(call.args[0], ast.Constant) or not isinstance(call.args[0].value, str):
            raise ValueError('python-route-unmeasured')
        roots = []
        for kw in call.keywords:
            if kw.arg != 'dependencies' or not isinstance(kw.value, ast.List):
                raise ValueError('python-route-options-unmeasured')
            roots += [dep(d) for d in kw.value.elts]
        _, defaults, _ = parameters(fn)
        roots += defaults
        routes.append({'entrypoint': 'entrypoint:' + call.func.attr.upper() + ' ' + call.args[0].value, 'name': fn.name, 'line': fn.lineno, 'roots': roots})
    selected = [r for r in routes if r['entrypoint'] == requested]
    if len(selected) != 1:
        raise ValueError('python-route-ambiguous-or-missing')
    route = selected[0]
    conditions = [c for name in route['roots'] for c in analyze(name)]
    if len(conditions) > 16:
        raise ValueError('python-chain-budget')
    return {'status': 'EXTRACTED', 'route': route, 'conditions': conditions, 'sourceSha256': hashlib.sha256(source.encode('utf8')).hexdigest()}


if __name__ == '__main__':
    try:
        data = json.load(sys.stdin)
        print(json.dumps(project(data['source'], data['entrypoint']), sort_keys=True))
    except Exception as error:
        print(json.dumps({'status': 'UNKNOWN', 'reason': str(error)[:160]}))
