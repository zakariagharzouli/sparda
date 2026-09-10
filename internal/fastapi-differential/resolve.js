// Stage 2: an independent, bounded Python/FastAPI semantic projection.
// No CPython AST, fastapi_extract.py, scanFunction or legacy resolver is imported.
import { registrationString } from './constants.js';
export const field = (n, key) => n?.children[n.fields[key]?.[0]];
const allFields = (n, key) => (n?.fields[key] ?? []).map((i) => n.children[i]);
const children = (n) => n?.children ?? [];
const dotted = (n) =>
  n?.kind === 'attribute'
    ? `${dotted(field(n, 'object'))}.${dotted(field(n, 'attribute'))}`
    : n?.value;
const args = (n) =>
  children(field(n, 'arguments')).filter((c) => c.kind !== 'keyword_argument');
const kw = (n, name) =>
  field(
    children(field(n, 'arguments')).find(
      (c) => c.kind === 'keyword_argument' && field(c, 'name')?.value === name,
    ),
    'value',
  );
const unwrap = (n) => (n?.kind === 'expression_statement' ? n.children[0] : n);
function literal(n) {
  if (n?.kind !== 'string' || children(n).some((c) => c.kind === 'interpolation'))
    return null;
  const s = n.value;
  if (
    !s ||
    !['"', "'"].includes(s[0]) ||
    s.includes('\\') ||
    s.startsWith(s[0].repeat(3))
  )
    return null;
  return s.slice(1, -1);
}
const walk = function* (node) {
  if (!node) return;
  yield node;
  for (const c of children(node)) yield* walk(c);
};
const verbs = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
]);
const sqlVerbs = new Map([
  ['select', 'db_read'],
  ['insert', 'db_write'],
  ['update', 'db_write'],
  ['delete', 'db_write'],
]);
export function resolveProject(
  syntax,
  entryFile,
  { maxDepth = 6, maxWork = 50_000 } = {},
) {
  const unknowns = [...syntax.unknowns],
    modules = new Map(),
    routes = [],
    bindings = [];
  const unknown = (reason, node, extra = {}) => {
    const u = {
      kind: 'UnknownBoundary',
      state: 'UNKNOWN',
      reason,
      provenance: node?.provenance ?? null,
      ...extra,
    };
    unknowns.push(u);
    return u;
  };
  let remaining = maxWork,
    exhausted = false;
  const spend = (node) => {
    if (--remaining >= 0) return true;
    if (!exhausted) unknown('semantic-work-budget', node);
    exhausted = true;
    return false;
  };
  for (const parsed of syntax.modules) {
    if (!parsed.root) continue;
    const m = {
      file: parsed.provenance.file,
      root: parsed.root,
      imports: new Map(),
      functions: new Map(),
      classes: new Map(),
      assignments: new Map(),
    };
    modules.set(m.file, m);
    for (const top of parsed.root.children) {
      const n =
        top.kind === 'decorated_definition' ? field(top, 'definition') : unwrap(top);
      if (
        n?.kind === 'assignment' &&
        [...walk(field(n, 'left'))].some(
          (part) =>
            part.kind === 'attribute' &&
            dotted(field(part, 'attribute')) === 'dependency_overrides',
        )
      )
        unknown('dependency-overrides', n);
      if (n?.kind === 'function_definition')
        m.functions.set(field(n, 'name').value, {
          node: n,
          module: m,
          decorators:
            top.kind === 'decorated_definition'
              ? top.children.filter((c) => c.kind === 'decorator')
              : [],
        });
      if (n?.kind === 'class_definition') {
        const cls = {
          node: n,
          module: m,
          name: field(n, 'name').value,
          methods: new Map(),
          table: null,
        };
        for (const c of children(field(n, 'body'))) {
          const member = unwrap(c);
          if (member?.kind === 'function_definition')
            cls.methods.set(field(member, 'name').value, {
              node: member,
              module: m,
              cls,
            });
          if (
            member?.kind === 'assignment' &&
            dotted(field(member, 'left')) === '__tablename__'
          )
            cls.table = literal(field(member, 'right'));
        }
        m.classes.set(cls.name, cls);
      }
      if (n?.kind === 'assignment' && field(n, 'left')?.kind === 'identifier')
        m.assignments.set(field(n, 'left').value, field(n, 'right'));
      if (n?.kind === 'import_from_statement') {
        const source = dotted(field(n, 'module_name'));
        for (const name of allFields(n, 'name')) {
          const original =
            name.kind === 'aliased_import' ? dotted(field(name, 'name')) : dotted(name);
          const alias =
            name.kind === 'aliased_import' ? dotted(field(name, 'alias')) : original;
          m.imports.set(alias, { source, name: original, provenance: n.provenance });
        }
      }
      if (n?.kind === 'import_statement')
        for (const name of allFields(n, 'name')) {
          const source =
            name.kind === 'aliased_import' ? dotted(field(name, 'name')) : dotted(name);
          const alias =
            name.kind === 'aliased_import'
              ? dotted(field(name, 'alias'))
              : source.split('.')[0];
          m.imports.set(alias, { source, name: null, provenance: n.provenance });
        }
    }
  }
  function localModule(m, source) {
    if (!source) return null;
    let parts;
    if (source.startsWith('.')) {
      const dots = source.match(/^\.+/)[0].length;
      parts = m.file.split('/').slice(0, -1);
      if (dots - 1 > parts.length) return null;
      parts = parts
        .slice(0, parts.length - dots + 1)
        .concat(source.slice(dots).split('.').filter(Boolean));
    } else parts = source.split('.');
    const p = parts.join('/');
    return modules.get(p + '.py') ?? modules.get(p + '/__init__.py') ?? null;
  }
  function symbol(m, name, depth = 0, seen = new Set()) {
    if (!spend(m.root)) return null;
    if (!name || depth > maxDepth) return null;
    const key = m.file + '#' + name;
    if (seen.has(key)) return null;
    const next = new Set(seen).add(key),
      [head, ...tail] = name.split('.');
    if (!tail.length && m.functions.has(head))
      return { kind: 'function', value: m.functions.get(head) };
    if (!tail.length && m.classes.has(head))
      return { kind: 'class', value: m.classes.get(head) };
    if (!tail.length && m.assignments.has(head))
      return { kind: 'assignment', value: m.assignments.get(head), module: m };
    const imp = m.imports.get(head);
    if (!imp) return null;
    const local = localModule(m, imp.source);
    if (local)
      return symbol(
        local,
        [imp.name, ...tail].filter(Boolean).join('.'),
        depth + 1,
        next,
      );
    if (imp.name && !tail.length) {
      const submodule = localModule(m, imp.source + '.' + imp.name);
      if (submodule) return { kind: 'module', value: submodule };
    }
    return {
      kind: 'external',
      name: [imp.source, imp.name, ...tail].filter(Boolean).join('.'),
    };
  }
  function qualified(m, n) {
    const s = symbol(m, dotted(n));
    return s?.kind === 'external' ? s.name : null;
  }
  function callable(m, n, current, depth = 0) {
    const name = dotted(n);
    if (!name || depth > maxDepth) return null;
    const direct = symbol(m, name);
    if (direct?.kind === 'function') return direct.value;
    if (n.kind === 'attribute') {
      const receiver = field(n, 'object'),
        method = dotted(field(n, 'attribute'));
      if (dotted(receiver) === 'self' && current?.cls)
        return current.cls.methods.get(method) ?? null;
      const instance = symbol(m, dotted(receiver));
      if (instance?.kind === 'assignment' && instance.value?.kind === 'call') {
        const cls = symbol(instance.module, dotted(field(instance.value, 'function')));
        if (cls?.kind === 'class') return cls.value.methods.get(method) ?? null;
      }
    }
    return null;
  }
  function dependencies(m, nodes, trail = []) {
    const out = [];
    for (const node of nodes.filter(Boolean))
      for (const n of walk(node)) {
        if (!spend(n)) return out;
        if (n.kind !== 'call') continue;
        const name = qualified(m, field(n, 'function'));
        if (!['fastapi.Depends', 'fastapi.Security'].includes(name)) {
          unknown('unmodelled-dependency-expression', n);
          continue;
        }
        const target = args(n)[0] ?? kw(n, 'dependency'),
          fn = callable(m, target),
          scopesNode = kw(n, 'scopes');
        if (kw(n, 'use_cache') || kw(n, 'scope'))
          unknown('dependency-lifecycle-options', n);
        const scopes =
          scopesNode?.kind === 'list'
            ? children(scopesNode).map(literal)
            : scopesNode
              ? null
              : [];
        const binding = {
          kind: 'DependencyBinding',
          dependencyKind: name.split('.').at(-1),
          target: dotted(target),
          state: fn ? 'RESOLVED' : 'UNKNOWN',
          scopes,
          authorizationProven: null,
          provenance: n.provenance,
          targetProvenance: fn?.node.provenance ?? null,
        };
        bindings.push(binding);
        out.push({ binding, fn });
        if (!fn) unknown('unresolved-dependency', n, { target: dotted(target) });
        if (scopesNode && (!scopes || scopes.some((s) => s === null)))
          unknown('dynamic-security-scopes', n);
        if (fn) {
          const id = fn.module.file + '#' + field(fn.node, 'name').value;
          if (trail.includes(id) || trail.length >= maxDepth)
            unknown('dependency-cycle-or-depth', n);
          else
            out.push(
              ...dependencies(fn.module, children(field(fn.node, 'parameters')), [
                ...trail,
                id,
              ]),
            );
        }
      }
    return out;
  }
  function builder(m, n, shadowed) {
    if (!spend(n)) return null;
    if (n?.kind !== 'call') return null;
    const callee = field(n, 'function'),
      q = shadowed.has(dotted(callee)?.split('.')[0]) ? null : qualified(m, callee);
    if (q?.startsWith('sqlalchemy.') && sqlVerbs.has(q.split('.').at(-1))) {
      const model = shadowed.has(dotted(args(n)[0])?.split('.')[0])
        ? null
        : symbol(m, dotted(args(n)[0]));
      const rebound =
        model?.kind === 'class' &&
        model.value.module.root.children.some((top) => {
          const assignment = unwrap(top);
          return (
            assignment?.kind === 'assignment' &&
            [model.value.name, model.value.name + '.__tablename__'].includes(
              dotted(field(assignment, 'left')),
            )
          );
        });
      return {
        op: q.split('.').at(-1),
        table: model?.kind === 'class' && !rebound ? model.value.table : null,
      };
    }
    if (
      callee?.kind === 'attribute' &&
      ['where', 'values', 'filter', 'returning', 'limit', 'order_by'].includes(
        dotted(field(callee, 'attribute')),
      )
    )
      return builder(m, field(callee, 'object'), shadowed);
    return null;
  }
  function directEffect(m, n, shadowed) {
    const callee = field(n, 'function'),
      method = callee?.kind === 'attribute' ? dotted(field(callee, 'attribute')) : null;
    if (['execute', 'scalars', 'scalar'].includes(method)) {
      const a = args(n)[0],
        statement = literal(a),
        b = builder(m, a, shadowed);
      if (b)
        return {
          effectType: sqlVerbs.get(b.op),
          op: b.op,
          table: b.table,
          provenance: n.provenance,
        };
      if (statement !== null) {
        const match = statement.match(
          /^\s*(select|insert\s+into|update|delete\s+from)\b/i,
        );
        if (match) {
          const op = match[1].toLowerCase().split(/\s/)[0];
          const tableMatch = statement.match(
            op === 'select'
              ? /\bfrom\s+([\w]+)/i
              : op === 'update'
                ? /^\s*update\s+([\w]+)/i
                : /\b(?:into|from)\s+([\w]+)/i,
          );
          return {
            effectType: sqlVerbs.get(op),
            op,
            table: tableMatch?.[1] ?? null,
            provenance: n.provenance,
          };
        }
      }
      return {
        effectType: 'db_read',
        op: 'unknown',
        table: null,
        provenance: n.provenance,
        uncertain: true,
      };
    }
    const q = qualified(m, callee);
    if (
      q &&
      /^(requests|httpx|aiohttp)\.(get|post|put|patch|delete|head|options)$/.test(q)
    )
      return {
        effectType: 'http_call',
        httpMethod: q.split('.').at(-1).toUpperCase(),
        target: literal(args(n)[0]),
        op: null,
        table: null,
        provenance: n.provenance,
      };
    return null;
  }
  function scan(fn, depth = 0, stack = new Set(), via = []) {
    const id =
      fn.module.file + '#' + (fn.cls?.name ?? '') + '#' + field(fn.node, 'name').value;
    if (depth > maxDepth || stack.has(id)) {
      unknown('call-cycle-or-depth', fn.node);
      return [];
    }
    const next = new Set(stack).add(id),
      effects = [];
    const shadowed = new Set([
      ...fn.module.assignments.keys(),
      ...children(field(fn.node, 'parameters')).map((p) =>
        p.kind === 'identifier' ? p.value : dotted(field(p, 'name')),
      ),
    ]);
    for (const node of walk(field(fn.node, 'body'))) {
      if (!spend(node)) return effects;
      if (node.kind === 'assignment' && field(node, 'left')?.kind === 'identifier')
        shadowed.add(field(node, 'left').value);
    }
    for (const n of walk(field(fn.node, 'body'))) {
      if (!spend(n)) return effects;
      if (n.kind === 'yield') unknown('yield-lifetime', n);
      if (n.kind !== 'call') continue;
      const e = directEffect(fn.module, n, shadowed);
      if (e) {
        effects.push({
          kind: 'Sink',
          state:
            e.uncertain || (!e.table && e.effectType.startsWith('db_'))
              ? 'UNKNOWN'
              : 'RESOLVED',
          ...e,
          via,
        });
        if (e.uncertain || (!e.table && e.effectType.startsWith('db_')))
          unknown('unresolved-database-effect', n);
        continue;
      }
      const target = callable(fn.module, field(n, 'function'), fn);
      if (target) effects.push(...scan(target, depth + 1, next, [...via, n.provenance]));
      else {
        const q = qualified(fn.module, field(n, 'function')),
          callee = dotted(field(n, 'function'));
        const structural =
          q?.startsWith('sqlalchemy.') ||
          q === 'fastapi.HTTPException' ||
          ['dict', 'list', 'str', 'int', 'len', 'bool', 'float', 'print'].includes(
            callee,
          );
        const fluent =
          field(n, 'function')?.kind === 'attribute' &&
          [
            'where',
            'values',
            'filter',
            'fetchone',
            'fetchall',
            'returning',
            'limit',
            'order_by',
          ].includes(dotted(field(field(n, 'function'), 'attribute')));
        if (!structural && !fluent) unknown('unresolved-call', n, { target: callee });
      }
    }
    return effects;
  }
  const visitedMounts = new Set();
  function mount(m, receiver, prefix, inherited = [], trail = []) {
    if (!spend(m.root)) return;
    const id = m.file + '#' + receiver + '#' + prefix;
    if (trail.includes(m.file + '#' + receiver) || trail.length >= maxDepth) {
      unknown('router-cycle-or-depth', m.root);
      return;
    }
    if (visitedMounts.has(id)) return;
    visitedMounts.add(id);
    const app = m.assignments.get(receiver),
      q = qualified(m, field(app, 'function'));
    if (!['fastapi.FastAPI', 'fastapi.APIRouter'].includes(q)) {
      unknown('unresolved-router', app ?? m.root);
      return;
    }
    const ownPrefixNode = kw(app, 'prefix'),
      ownPrefix = ownPrefixNode ? literal(ownPrefixNode) : '';
    if (ownPrefix === null) {
      unknown('dynamic-router-prefix', app);
      return;
    }
    const deps = [...inherited, ...dependencies(m, [kw(app, 'dependencies')])];
    const base = prefix + ownPrefix;
    for (const fn of m.functions.values())
      for (const decorator of fn.decorators) {
        const call = decorator.children[0],
          callee = field(call, 'function');
        if (callee?.kind !== 'attribute' || dotted(field(callee, 'object')) !== receiver)
          continue;
        const method = dotted(field(callee, 'attribute'));
        if (!verbs.has(method)) {
          unknown('unsupported-route-registration', decorator);
          continue;
        }
        const pathResolution = registrationString(
          m.root,
          args(call)[0] ?? kw(call, 'path'),
          spend,
        );
        if (pathResolution === null) {
          unknown('dynamic-route-path', decorator, { method });
          continue;
        }
        const routeDeps = [
          ...deps,
          ...dependencies(m, [kw(call, 'dependencies'), field(fn.node, 'parameters')]),
        ];
        const effects = [
          ...routeDeps.flatMap((d) => (d.fn ? scan(d.fn) : [])),
          ...scan(fn),
        ];
        routes.push({
          kind: 'RouteEntry',
          method,
          path: base + pathResolution.value,
          pathProvenance: pathResolution.evidence,
          handler: field(fn.node, 'name').value,
          provenance: fn.node.provenance,
          dependencies: routeDeps.map((d) => d.binding),
          effects,
          authorizationProven: null,
          sources: children(field(fn.node, 'parameters')).map((p) => ({
            kind: 'Source',
            state: 'UNKNOWN',
            origin: null,
            name: dotted(field(p, 'name')) ?? p.value,
            provenance: p.provenance,
          })),
        });
      }
    for (const top of m.root.children) {
      const call = unwrap(top),
        callee = field(call, 'function');
      if (call?.kind !== 'call' || dotted(callee) !== receiver + '.include_router')
        continue;
      const target = symbol(m, dotted(args(call)[0] ?? kw(call, 'router'))),
        pNode = kw(call, 'prefix'),
        p = pNode ? literal(pNode) : '';
      if (target?.kind !== 'assignment' || p === null) {
        unknown('unresolved-router-mount', call);
        continue;
      }
      const targetName = [...target.module.assignments].find(
        ([, value]) => value === target.value,
      )?.[0];
      mount(
        target.module,
        targetName,
        base + p,
        [...deps, ...dependencies(m, [kw(call, 'dependencies')])],
        [...trail, m.file + '#' + receiver],
      );
    }
  }
  const entry = modules.get(entryFile.replaceAll('\\', '/'));
  if (!entry) unknown('entry-unavailable', null, { file: entryFile });
  else {
    let apps = 0;
    for (const [name, expr] of entry.assignments)
      if (qualified(entry, field(expr, 'function')) === 'fastapi.FastAPI') {
        apps++;
        mount(entry, name, '');
      }
    if (!apps) unknown('entry-app-unresolved', entry.root);
  }
  routes.sort((a, b) =>
    `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`, 'en'),
  );
  return {
    schema: 'semantic-project/v1',
    language: 'python',
    routes,
    bindings,
    unknowns,
    state: unknowns.length ? 'UNKNOWN' : 'MODELLED',
    authorizationProven: null,
  };
}
