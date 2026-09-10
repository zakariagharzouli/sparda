// A deliberately small grammar for zero-argument local filter producers.
// Returns are alternatives, not claims that a branch executes. Mutable or
// shadowed producer names and producers with statements outside the grammar
// remain opaque. No expression or target function is executed.
const cache = new WeakMap();
export function localReturnPaths(owner) {
  if (!owner || typeof owner !== 'object') return new Map();
  if (cache.has(owner)) return cache.get(owner);
  const candidates = new Map(),
    counts = new Map(),
    writes = new Set(),
    calls = new Map();
  let fuel = 10000;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (--fuel < 0) throw new Error('budget');
    if (node.type === 'Identifier')
      counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier')
      calls.set(node.callee.name, node);
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const target = node.left ?? node.argument;
      if (target?.type === 'Identifier') writes.add(target.name);
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        [
          'loc',
          'start',
          'end',
          'extra',
          'leadingComments',
          'trailingComments',
          'innerComments',
          'tokens',
          'comments',
        ].includes(key)
      )
        continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  const pureTest = (n) =>
    n?.type === 'Identifier' ||
    n?.type === 'BooleanLiteral' ||
    (n?.type === 'UnaryExpression' && n.operator === '!' && pureTest(n.argument));
  const returns = (node, out, depth = 0) => {
    if (!node || depth > 8) return false;
    if (node.type === 'BlockStatement')
      return node.body.every((n) => returns(n, out, depth + 1));
    if (node.type === 'ReturnStatement' && node.argument) {
      out.push(node.argument);
      return true;
    }
    if (node.type === 'IfStatement' && pureTest(node.test))
      return (
        returns(node.consequent, out, depth + 1) &&
        (!node.alternate || returns(node.alternate, out, depth + 1))
      );
    return false;
  };
  const value = (n, depth = 0) => {
    if (!n || depth > 8) return false;
    if (
      [
        'Identifier',
        'StringLiteral',
        'NumericLiteral',
        'BooleanLiteral',
        'NullLiteral',
      ].includes(n.type)
    )
      return true;
    if (n.type === 'MemberExpression') return !n.computed && value(n.object, depth + 1);
    if (n.type === 'TemplateLiteral')
      return n.expressions.every((e) => value(e, depth + 1));
    if (n.type === 'ObjectExpression')
      return n.properties.every(
        (p) => p.type === 'ObjectProperty' && !p.computed && value(p.value, depth + 1),
      );
    return false;
  };
  try {
    visit(owner.body);
    for (const statement of owner.body?.body ?? []) {
      if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const')
        continue;
      for (const declaration of statement.declarations) {
        const fn = declaration.init,
          name = declaration.id?.name;
        if (
          declaration.id?.type !== 'Identifier' ||
          fn?.type !== 'ArrowFunctionExpression' ||
          fn.params.length ||
          fn.async ||
          fn.generator ||
          writes.has(name)
        )
          continue;
        // Exactly the declaration and one call reference: any second use, alias,
        // inner declaration, capture or escape declines this first grammar.
        if (counts.get(name) !== 2) continue;
        const call = calls.get(name);
        if (!call || call.arguments.length || call.start <= fn.end) continue;
        const alternatives = [];
        if (fn.body.type === 'BlockStatement') {
          if (!returns(fn.body, alternatives)) continue;
        } else alternatives.push(fn.body);
        if (
          alternatives.length &&
          alternatives.length <= 8 &&
          alternatives.every((n) => value(n))
        )
          candidates.set(name, alternatives);
      }
    }
  } catch {
    candidates.clear();
  }
  cache.set(owner, candidates);
  return candidates;
}
