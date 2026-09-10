"""Mark Security calls only when their FastAPI import binding is unambiguous."""
import ast
import os


def mark_security_calls(tree, root, source_file):
    names, modules, counts = set(), set(), {}
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                local = alias.asname or alias.name.split('.')[0]
                counts[local] = counts.get(local, 0) + 1
                if isinstance(node, ast.ImportFrom) and node.module == 'fastapi' and not node.level and alias.name == 'Security':
                    names.add(local)
                if isinstance(node, ast.Import) and alias.name == 'fastapi':
                    modules.add(local)
    shadowed = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            shadowed.add(node.id)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            shadowed.add(node.name)
        if isinstance(node, ast.arg):
            shadowed.add(node.arg)
    shadowed.update(name for name, count in counts.items() if count != 1)
    local_framework = any(os.path.exists(os.path.join(base, candidate))
                          for base in (root, os.path.dirname(source_file))
                          for candidate in ('fastapi.py', 'fastapi'))
    declined = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        callee = node.func
        direct = isinstance(callee, ast.Name) and callee.id in names
        member = isinstance(callee, ast.Attribute) and callee.attr == 'Security' and isinstance(callee.value, ast.Name) and callee.value.id in modules
        suspected = direct or member or isinstance(callee, ast.Name) and callee.id == 'Security' or isinstance(callee, ast.Attribute) and callee.attr == 'Security'
        if not suspected:
            continue
        binding = callee.id if isinstance(callee, ast.Name) else callee.value.id if isinstance(callee.value, ast.Name) else None
        node._sparda_security = bool((direct or member) and binding not in shadowed and not local_framework)
        if not node._sparda_security:
            declined.append(node.lineno)
    return declined
