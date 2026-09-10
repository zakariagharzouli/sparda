// Registration-time constants only. No Python execution, imported values or aliasing.
const field = (n, key) => n?.children[n.fields[key]?.[0]];
const walk = function* (n) {
  if (!n) return;
  yield n;
  for (const c of n.children ?? []) yield* walk(c);
};
const unwrap = (n) => (n?.kind === 'expression_statement' ? n.children[0] : n);
const text = (n) => {
  if (n?.kind !== 'string' || n.children.some((c) => c.kind === 'interpolation'))
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
};

export function registrationString(root, expression, spend = () => true) {
  const direct = text(expression);
  if (direct !== null) return { value: direct, evidence: [expression.provenance] };
  if (expression?.kind === 'subscript' && expression.fields.subscript?.length !== 1)
    return null;
  const receiver =
    expression?.kind === 'subscript' ? field(expression, 'value') : expression;
  if (receiver?.kind !== 'identifier') return null;
  const name = receiver.value;
  const declarations = root.children
    .map(unwrap)
    .filter((n) => n.kind === 'assignment' && field(n, 'left')?.value === name);
  if (declarations.length !== 1) return null;
  const declaration = declarations[0],
    value = field(declaration, 'right');
  // Constants must exist before the decorator is evaluated, never from later rebinding.
  if (declaration.provenance.startByte >= expression.provenance.startByte) return null;
  const allowed = new Set([field(declaration, 'left')]);
  for (const top of root.children) {
    if (top.kind !== 'decorated_definition') continue;
    for (const decorator of top.children.filter((n) => n.kind === 'decorator')) {
      const call = decorator.children[0],
        args = field(call, 'arguments');
      if (call?.kind !== 'call') continue;
      const path =
        args?.children.find((n) => n.kind !== 'keyword_argument') ??
        field(
          args?.children.find(
            (n) => n.kind === 'keyword_argument' && field(n, 'name')?.value === 'path',
          ),
          'value',
        );
      // Only a scalar or a literal-key dictionary read can consume the constant.
      if (path?.kind === 'identifier' && value?.kind === 'string') allowed.add(path);
      if (path?.kind === 'subscript' && text(field(path, 'subscript')) !== null)
        allowed.add(field(path, 'value'));
    }
  }
  for (const n of walk(root)) {
    if (!spend(n)) return null;
    if (n.kind === 'identifier' && n.value !== n.value.normalize('NFKC')) return null;
    if (
      n.kind === 'wildcard_import' ||
      ['exec', 'eval', 'globals', 'locals', '__import__'].includes(n.value)
    )
      return null;
    if (n.kind === 'identifier' && n.value === name && !allowed.has(n)) return null;
  }
  if (expression.kind === 'identifier') {
    const result = text(value);
    return result === null
      ? null
      : { value: result, evidence: [declaration.provenance, expression.provenance] };
  }
  if (value?.kind !== 'dictionary' || value.children.length > 64) return null;
  const key = text(field(expression, 'subscript'));
  if (key === null) return null;
  const entries = new Map();
  for (const pair of value.children) {
    if (pair.kind !== 'pair') return null;
    const k = text(field(pair, 'key')),
      v = text(field(pair, 'value'));
    if (k === null || v === null || entries.has(k)) return null;
    entries.set(k, {
      value: v,
      evidence: [declaration.provenance, pair.provenance, expression.provenance],
    });
  }
  return entries.get(key) ?? null;
}
