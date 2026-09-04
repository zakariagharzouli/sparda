// ubg/kernel/bindings.js — lexical capture, made structural.
//
// The resolver has always collected bindings from the body it is scanning. That
// is correct for a flat handler and blind for the dominant pre-class Node
// idiom, where the handler is an ARROW installed by a constructor and every
// dependency it uses lives in the constructor's scope:
//
//   function AllocationsHandler(db) {
//     const allocationsDAO = new AllocationsDAO(db);       // ← captured
//     this.displayAllocations = (req, res) => {
//       allocationsDAO.getByUserIdAndThreshold(...)        // ← receiver is captured
//     };
//   }
//
//   const AllocationsDAO = function (db) {
//     const allocationsCol = db.collection("allocations"); // ← captured
//     this.getByUserIdAndThreshold = (userId, t, cb) => {
//       allocationsCol.find(...)                            // ← receiver is captured
//     };
//   };
//
// Neither receiver is declared in the body that uses it, so both calls resolved
// to nothing — and an unresolved receiver leaves no route, no skip and no
// unknown handler behind it. Measured on NodeGoat at its pinned commit: 19
// routes linked, and ZERO effects in the entire compiled graph.
//
// This module collects the bindings of ONE scope, deliberately excluding nested
// function bodies: those are their own scopes, and the resolver already scans
// them. Capture is therefore a chain of these, outermost last.
// Deliberately dependency-free: `resolve.js` imports this module, so importing
// its walker back would close a cycle around the resolution engine.
function walkAst(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, fn);
    return;
  }
  if (typeof node.type === 'string') fn(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (child && typeof child === 'object') walkAst(child, fn);
  }
}

// The MongoDB Node driver's documented handle constructor: `Db.collection(name)`
// returns a Collection. This is a contract on the CALL SHAPE, not on the name of
// the receiver — `db`, `database`, `conn` and `this.client` all reach it, and a
// receiver named `db` that never calls `.collection()` yields nothing.
const COLLECTION_FACTORY = 'collection';

// Statement-level bindings of one function scope. Nested functions are skipped:
// a `const x = new Y()` inside a callback belongs to the callback's scope, and
// crediting it to the enclosing one would resolve a receiver that, at the call
// site we care about, does not exist yet.
function ownScopeDeclarators(fnNode) {
  const out = [];
  const body = fnNode?.body;
  if (!body) return out;
  const visit = (node, root) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, root);
      return;
    }
    if (
      !root &&
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'ClassMethod' ||
        node.type === 'ObjectMethod')
    )
      return;
    if (node.type === 'VariableDeclarator') out.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (child && typeof child === 'object') visit(child, false);
    }
  };
  visit(body, true);
  return out;
}

// `db.collection('allocations')` → { store: 'mongo', table: 'allocations' }.
// A non-literal argument is NOT guessed: it becomes a symbolic target so the
// caller can record an UnknownBoundary with `dynamic-target` rather than
// inventing a collection name (SOUNDNESS Direction 2 — never fabricate).
function collectionHandleOf(init) {
  if (
    init?.type !== 'CallExpression' ||
    init.callee?.type !== 'MemberExpression' ||
    init.callee.computed ||
    init.callee.property?.type !== 'Identifier' ||
    init.callee.property.name !== COLLECTION_FACTORY
  )
    return null;
  const arg = init.arguments?.[0];
  const line = init.loc?.start.line ?? 0;
  if (arg?.type === 'StringLiteral')
    return { store: 'mongo', table: arg.value, line, symbolic: false };
  return { store: 'mongo', table: null, line, symbolic: true };
}

// Functions declared INSIDE a body — `const searchCriteria = () => {…}`, or a
// nested `function helper() {}`. `parseModule` only records TOP-LEVEL functions,
// so a bare call to one of these resolved to nothing and its behavior never
// merged upward. Measured on NodeGoat: the Mongo filter of
// `GET /allocations/:userId` is built by exactly such a nested helper
// (`find(searchCriteria())`), so the request→filter link stopped one hop short.
//
// The whole subtree is collected rather than one lexical level: a nested
// function is visible to every call site that can name it, and JavaScript's own
// scoping already guarantees a call cannot see a binding that is not in scope.
export function localFunctions(fnNode) {
  const out = new Map();
  walkAst(fnNode?.body, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      (node.init?.type === 'ArrowFunctionExpression' ||
        node.init?.type === 'FunctionExpression')
    ) {
      if (!out.has(node.id.name)) out.set(node.id.name, node.init);
    } else if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      if (!out.has(node.id.name)) out.set(node.id.name, node);
    }
  });
  return out;
}

// The bindings ONE scope publishes to the closures it creates.
export function scopeBindings(fnNode) {
  const instances = new Map(); // name → { className, args, line }
  const collections = new Map(); // name → { store, table, line, symbolic }
  const aliases = new Map(); // name → name (plain identifier aliasing)

  for (const declarator of ownScopeDeclarators(fnNode)) {
    if (declarator.id?.type !== 'Identifier') continue;
    const name = declarator.id.name;
    const init = declarator.init;
    if (!init) continue;

    if (init.type === 'NewExpression' && init.callee?.type === 'Identifier') {
      instances.set(name, {
        className: init.callee.name,
        args: init.arguments ?? [],
        line: init.loc?.start.line ?? 0,
      });
      continue;
    }
    const collection = collectionHandleOf(init);
    if (collection) {
      collections.set(name, collection);
      continue;
    }
    if (init.type === 'Identifier') aliases.set(name, init.name);
  }

  // Resolve one alias hop against the same scope so `const c = col;` keeps its
  // provenance. Deliberately one hop and non-recursive: an alias chain long
  // enough to need a fixpoint is not a shape this contract claims to model.
  for (const [name, target] of aliases) {
    if (instances.has(target) && !instances.has(name))
      instances.set(name, instances.get(target));
    if (collections.has(target) && !collections.has(name))
      collections.set(name, collections.get(target));
  }

  return { instances, collections };
}

// A capture chain: the scopes enclosing a body, innermost FIRST. Lookup walks it
// in order, so an inner shadowing declaration wins over an outer one — the same
// rule JavaScript itself applies.
export function captureChain(scopes) {
  const chain = (scopes ?? []).filter(Boolean);
  return {
    scopes: chain,
    instance(name) {
      for (const scope of chain)
        if (scope.instances.has(name)) return scope.instances.get(name);
      return null;
    },
    collection(name) {
      for (const scope of chain)
        if (scope.collections.has(name)) return scope.collections.get(name);
      return null;
    },
    get size() {
      return chain.reduce(
        (total, scope) => total + scope.instances.size + scope.collections.size,
        0,
      );
    },
  };
}

// Receivers whose calls are NOT application behavior: the JavaScript standard
// library, the Node host surface, and the three objects Express hands a handler.
// A call on one of these cannot hide a route, an effect or a guard, so stopping
// there is a completed classification rather than an abandoned hop.
//
// This list is the counterpart of the rule that everything else which fails to
// resolve becomes an `UnknownBoundary`. Adding a name here is a DELIBERATE claim
// that no application behavior can live behind it — the same contract
// `NON_ROUTE_METHODS` carries in express.js. It is the only way to make the
// resolver quiet again, and it is auditable in one screen.
//
// `req`/`res`/`next` are here because the Express contract already models them:
// the request surface becomes `DataSource` facts and the response is not state.
// A user object that merely happens to be named `res` would be misclassified —
// accepted, because the alternative is an `UnknownBoundary` on every
// `res.json()` in every Node application, which would drown the ledger and make
// `byUncertainty` describe JavaScript instead of the program.
const INERT_RECEIVERS = new Set([
  // JavaScript standard built-ins
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Math',
  'JSON',
  'Date',
  'RegExp',
  'Symbol',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Error',
  'TypeError',
  'RangeError',
  'Reflect',
  'Proxy',
  'BigInt',
  'Intl',
  // Node host surface
  'process',
  'Buffer',
  'console',
  'globalThis',
  // Express handler triad — modelled by the express/router contract
  'req',
  'request',
  'res',
  'response',
  'next',
]);

export const isInertReceiver = (name) => INERT_RECEIVERS.has(name);

// Every identifier used as a CALL RECEIVER in this body (`x.m()`), with the line
// of the call. This is what makes an unresolved receiver visible: the resolver
// compares this set against what it managed to bind, and every leftover becomes
// an UnknownBoundary instead of a silent `return`.
export function calledReceivers(fnNode) {
  const receivers = new Map();
  walkAst(fnNode, (node) => {
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
    const callee = node.callee;
    if (
      callee?.type !== 'MemberExpression' ||
      callee.object?.type !== 'Identifier' ||
      callee.property?.type !== 'Identifier'
    )
      return;
    const key = `${callee.object.name}.${callee.property.name}`;
    if (!receivers.has(key))
      receivers.set(key, {
        receiver: callee.object.name,
        method: callee.property.name,
        line: node.loc?.start.line ?? 0,
      });
  });
  return [...receivers.values()];
}
