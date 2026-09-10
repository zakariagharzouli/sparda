// A bounded description of a middleware's admission condition, not a new
// verified guard or an authorization policy. Only the request/response/next
// parameters of a direct Express registration give these operations meaning.
const member = (n) =>
  n?.type === 'Identifier'
    ? n.name
    : n?.type === 'MemberExpression' && !n.computed
      ? `${member(n.object)}.${n.property.name}`
      : null;
const statements = (n) => (n?.type === 'BlockStatement' ? n.body : [n]);
const single = (n) => {
  const body = statements(n);
  return body.length === 1 ? body[0] : null;
};
export function sessionAdmission(fn) {
  if (
    !fn ||
    fn.async ||
    fn.generator ||
    fn.params?.length !== 3 ||
    fn.params.some((p) => p.type !== 'Identifier')
  )
    return null;
  const names = fn.params.map((p) => p.name);
  if (new Set(names).size !== 3) return null;
  const [req, res, next] = names,
    body = fn.body?.body;
  if (!Array.isArray(body) || body.length < 2 || body.length > 4) return null;
  const first = body[0];
  if (first.type !== 'IfStatement' || first.alternate) return null;
  const negated = first.test.type === 'UnaryExpression' && first.test.operator === '!';
  const condition = negated ? first.test.argument : first.test;
  const field = member(condition),
    prefix = `${req}.session.`;
  if (
    !field?.startsWith(prefix) ||
    !/^[A-Za-z_$][\w$]*$/.test(field.slice(prefix.length))
  )
    return null;
  const passes = (s) =>
    s?.type === 'ReturnStatement' &&
    s.argument?.type === 'CallExpression' &&
    member(s.argument.callee) === next &&
    s.argument.arguments.length === 0;
  const denies = (s) => {
    if (s?.type !== 'ReturnStatement' || s.argument?.type !== 'CallExpression')
      return false;
    const call = s.argument,
      name = member(call.callee);
    return (
      (name === `${res}.redirect` &&
        call.arguments.length === 1 &&
        call.arguments[0].type === 'StringLiteral') ||
      (name === `${res}.sendStatus` &&
        call.arguments.length === 1 &&
        call.arguments[0].type === 'NumericLiteral' &&
        [401, 403].includes(call.arguments[0].value))
    );
  };
  if (
    body
      .slice(1, -1)
      .some(
        (s) =>
          s.type !== 'ExpressionStatement' ||
          s.expression.type !== 'CallExpression' ||
          member(s.expression.callee) !== 'console.log' ||
          s.expression.arguments.some((a) => a.type !== 'StringLiteral'),
      )
  )
    return null;
  if (
    negated
      ? !denies(single(first.consequent)) || !passes(body.at(-1))
      : !passes(single(first.consequent)) || !denies(body.at(-1))
  )
    return null;
  return {
    schema: 'session-admission/v1',
    origin: 'session',
    name: field.slice(prefix.length),
    condition: 'truthy',
    rejection: 'returns-without-next',
    authorizationProven: null,
  };
}
