import { readBoolean } from './boolean-contract.js';

// Express continuation admission under stable, ordinary request data properties.
// This does not model the terminal handler, effects or arbitrary JavaScript calls.
export function admissionCondition(fn) {
  let visits = 0;
  const traces = [];
  try {
    if (
      !fn ||
      fn.async ||
      fn.generator ||
      fn.params?.length !== 3 ||
      fn.params.some((p) => p.type !== 'Identifier') ||
      new Set(fn.params.map((p) => p.name)).size !== 3
    )
      throw Error('unsupported-parameters');
    const [req, res, next] = fn.params.map((p) => p.name);
    const member = (n) =>
      n?.type === 'Identifier'
        ? n.name
        : n?.type === 'MemberExpression' && !n.computed && !n.optional
          ? `${member(n.object)}.${n.property.name}`
          : null;
    const tick = (depth) => {
      if (++visits > 128 || depth > 24) throw Error('admission-budget');
    };
    function condition(n, depth = 0) {
      tick(depth);
      if (n?.type === 'BooleanLiteral') return n.value;
      if (n?.type === 'UnaryExpression' && n.operator === '!')
        return ['not', condition(n.argument, depth + 1)];
      if (n?.type === 'LogicalExpression' && ['&&', '||'].includes(n.operator))
        return [
          n.operator === '&&' ? 'and' : 'or',
          condition(n.left, depth + 1),
          condition(n.right, depth + 1),
        ];
      const name = member(n),
        prefix = `${req}.session.`;
      if (
        !name?.startsWith(prefix) ||
        !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name.slice(prefix.length))
      )
        throw Error('unsupported-predicate');
      const atom = 'session.' + name.slice(prefix.length);
      traces.push({ atom, start: n.start, end: n.end, line: n.loc?.start.line });
      return atom;
    }
    const and = (a, b) =>
      a === false || b === false
        ? false
        : a === true
          ? b
          : b === true
            ? a
            : ['and', a, b];
    const or = (values) =>
      values.length === 0 ? false : values.length === 1 ? values[0] : ['or', ...values];
    // Analyze backwards: a returned continuation terminates this invocation.
    function sequence(body, after, depth) {
      tick(depth);
      if (!Array.isArray(body) || body.length > 64) throw Error('unsupported-body');
      let result = after;
      for (let i = body.length - 1; i >= 0; i--)
        result = statement(body[i], result, depth + 1);
      return result;
    }
    function statement(n, after, depth) {
      tick(depth);
      if (n?.type === 'BlockStatement') return sequence(n.body, after, depth + 1);
      if (n?.type === 'IfStatement') {
        const test = condition(n.test),
          yes = statement(n.consequent, after, depth + 1),
          no = n.alternate ? statement(n.alternate, after, depth + 1) : after;
        return or([and(test, yes), and(['not', test], no)]);
      }
      if (n?.type === 'ReturnStatement') {
        const call = n.argument;
        if (call?.type !== 'CallExpression' || call.optional)
          throw Error('unsupported-return');
        const target = member(call.callee);
        if (target === next && call.arguments.length === 0) return true;
        if (
          (target === `${res}.sendStatus` &&
            call.arguments.length === 1 &&
            call.arguments[0].type === 'NumericLiteral' &&
            [401, 403].includes(call.arguments[0].value)) ||
          (target === `${res}.redirect` &&
            call.arguments.length === 1 &&
            call.arguments[0].type === 'StringLiteral')
        )
          return false;
        throw Error('unsupported-return');
      }
      throw Error('unsupported-statement');
    }
    // Falling off a middleware does not invoke next; it stalls the request.
    const formula =
      fn.body?.type === 'BlockStatement'
        ? sequence(fn.body.body, false, 0)
        : statement({ type: 'ReturnStatement', argument: fn.body }, false, 0);
    return {
      conditionExtracted: true,
      formula: readBoolean(formula).tree,
      traces,
      assumptions: [
        'stable-plain-session-data',
        'ordinary-express-next-response-semantics',
      ],
      authorizationViolation: null,
    };
  } catch (error) {
    return {
      conditionExtracted: null,
      formula: null,
      traces: [],
      reason: error.message,
      authorizationViolation: null,
    };
  }
}
