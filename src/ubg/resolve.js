// ubg/resolve.js — THE interprocedural resolution engine (ADR-054).
//
// Before this module, every framework paid for call-following separately: the
// Nest extractor had its DI follower (`methodBundle`), the Express extractor its
// module/instance follower (`deepScan`), and Next/Python had nothing — three
// implementations of the same machine (bounded depth, cycle guard, memoization,
// scan merging), guaranteed to diverge. This module owns that machine once;
// framework extractors are CONFIGURATIONS of it, not re-implementations.
//
// Phase 1 shipped the extraction at byte-identity (ADR-054). Phase 2 (this
// state) CONVERGED the strategies: there is ONE walk (`followCalls`) and one
// memoized bundle builder (`classMethodBundle`); constructor-type DI is a
// RECEIVER KIND inside that walk (`this.<prop>.<m>()` where <prop> is a DI'd
// dependency), not a separate machine. Convergence is what enriches every
// framework at once: a Nest handler now also resolves instantiated services,
// imported module calls, and `this.<m>()` sibling dispatch — capabilities that
// used to belong to the Express path only. Gate: every fixture + corpus
// verdict and finding set identical to the pre-convergence baseline (effect
// counts may rise — that is the win).
import path from 'node:path';
import {
  parseModule,
  scanFunction,
  classInModule,
  baseClassOf,
  methodInClassChain,
  computeThisSymbols,
  resolveExportedFunction,
  resolveExportedClass,
  collectRepoFields,
  collectReqDerived,
  localChain,
  reqParamName,
  requestOriginOf,
  callBindsOwnershipWitness,
} from './extract.js';
import {
  scopeBindings,
  captureChain,
  isInertReceiver,
  localFunctions,
} from './kernel/bindings.js';
import { factId, makeFact, record } from './kernel/facts.js';
import { surfaceOfParameter } from './nest-provider-tapp.js';
import { bodyKey } from './schema.js';

export const MAX_RESOLVE_DEPTH = 6;

// Bare calls that are the language or the host, not the application. Same
// contract as INERT_RECEIVERS: a name here is a deliberate claim that no
// application behavior hides behind it.
// Event/queue verbs. A producer or consumer reached on a receiver the walk could
// not bind means the OTHER end of the pair is not statically known — a more
// precise cause than "unresolved receiver" for the same stop, because it says
// the behavior continues somewhere the walk cannot name.
const QUEUE_VERBS = new Set([
  'on',
  'once',
  'emit',
  'publish',
  'subscribe',
  'send',
  'add',
  'process',
  'enqueue',
  'dispatch',
]);

const GLOBAL_FUNCTIONS = new Set([
  'require',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'setImmediate',
  'queueMicrotask',
  'structuredClone',
  'fetch',
  'next',
  'done',
  'callback',
  'cb',
  'resolve',
  'reject',
]);

// The leftmost identifier of a member chain — `a.b.c()` → `a`. Used only to give
// an UnknownBoundary a stable, human-readable symbol.
// A call that hands over a function argument continues LATER. When the callee
// itself did not resolve, whether and when that continuation runs is unknown.
const handsOverCallback = (node) =>
  (node.arguments ?? []).some(
    (a) => a?.type === 'ArrowFunctionExpression' || a?.type === 'FunctionExpression',
  );

function calleeRootName(callee) {
  let cur = callee;
  for (let hops = 0; hops < 8 && cur; hops++) {
    if (cur.type === 'MemberExpression') cur = cur.object;
    else if (cur.type === 'CallExpression') cur = cur.callee;
    else if (cur.type === 'Identifier') return cur.name;
    else return null;
  }
  return null;
}

// E-099 — an effect's LINE belongs to the body that produced it, and in a DI app that
// body is almost never in the route's file: the walk below hops controller → service →
// repository, merging effects upward as it goes. Only the line survived that trip, so
// the graph paired it with the OWNER's file and every deep blind spot named a real file
// at a line that belongs to another one — individually right, jointly meaningless, and
// unusable as a ledger. The declaring file is stamped HERE, at each scan boundary, where
// the module is still known.
//
// `??=`, so the DEEPEST stamp wins: a bundle is stamped by its own scan before it is
// merged into a caller, and re-stamping is a no-op. That also makes it safe on the
// memoized bundles, whose effect objects are shared by reference across every parent
// that reaches them — the value is a property of the effect, not of the path to it.
export function stampDeclaringFile(scan, file) {
  if (file) for (const e of scan.effects) e.file ??= file;
  return scan;
}

// merge one scan's findings into another — the single copy of the contract
// every follower shares.
export function mergeScan(into, add) {
  // Guard-dominance (C2) is a property of the ROUTE HANDLER's own body: a mutation that runs before
  // the handler's auth check. A `bypassesGuard` computed inside a delegated/transitively-called body
  // is that body's INTERNAL ordering (a service that mutates then runs a permission check) — not the
  // route's auth gate, exactly as "effects merge; guards do not" (below). Strip it at the merge so a
  // service's internal shape never flags the route. The handler's own effects live in `into` from
  // the start and are never merged, so they keep their flag.
  for (const e of add.effects) if (e.bypassesGuard) delete e.bypassesGuard;
  into.effects.push(...add.effects);
  into.returnShapes = [...(into.returnShapes ?? []), ...(add.returnShapes ?? [])];
  into.calls = [...(into.calls ?? []), ...(add.calls ?? [])];
  // Continuations merge like effects: a DB write behind a callback three modules
  // down is still a write behind a callback from the route's point of view.
  into.continuations = [...(into.continuations ?? []), ...(add.continuations ?? [])];
  into.validatesInput = into.validatesInput || add.validatesInput;
  into.async = into.async || add.async;
  if (add.guardSignals?.deniesWithStatus) into.guardSignals.deniesWithStatus = true;
  // G1/G2 (advisory-only): a delegated service method that asserts caller-ownership, or refuses on
  // a credential check (throw/4xx/verify/redirect), carries that signal UP to the handler it is
  // reached from. Without this a Nest/DI refusal that lives one class away (`this.service.x()`) is
  // dropped at the merge and its route reads as a false critical — the first-run / admin-setup and
  // API-key families. These signals can only DOWNGRADE a critical to advisory, never prove.
  if (add.ownerAsserted) into.ownerAsserted = true;
  if (add.credentialSignals) {
    into.credentialSignals ??= {
      verifyCall: false,
      denies4xxOrThrows: false,
      redirects: false,
    };
    if (add.credentialSignals.verifyCall) into.credentialSignals.verifyCall = true;
    if (add.credentialSignals.denies4xxOrThrows)
      into.credentialSignals.denies4xxOrThrows = true;
    if (add.credentialSignals.redirects) into.credentialSignals.redirects = true;
  }
}

export const relOf = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/');

// depth-first walk over an AST subtree, invoking fn on every node.
export function walkAst(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkAst(n, fn);
    return;
  }
  if (typeof node.type === 'string') fn(node);
  for (const k of Object.keys(node)) {
    if (
      k === 'loc' ||
      k === 'range' ||
      k === 'leadingComments' ||
      k === 'trailingComments'
    )
      continue;
    const v = node[k];
    if (v && typeof v === 'object') walkAst(v, fn);
  }
}

export function walkCalls(node, fn) {
  walkAst(node, (n) => {
    if (n.type === 'CallExpression') fn(n);
  });
}

// Resolve a method installed by a CommonJS constructor factory. Older Express
// applications commonly write `function Handler(db) { this.update = (req) => … }
// module.exports = Handler`, then register `new Handler(db).update`. This is a
// real interprocedural edge, not a name heuristic: the constructor module and the
// exact `this.<member> = function` assignment must both be readable. A miss stays
// null so the caller can retain its opaque/UNKNOWN boundary.
export function resolveInstanceMember(mod, typeName, memberName) {
  if (!mod || mod.error || !typeName || !memberName) return null;
  const direct = mod.functions.get(typeName)?.node ?? commonJsEntrypoint(mod);
  if (!direct) {
    const cls = classInModule(mod, typeName);
    const method = cls?.body.body.find(
      (node) =>
        node.type === 'ClassMethod' &&
        node.key?.type === 'Identifier' &&
        node.key.name === memberName,
    );
    return method ? { fn: method, line: method.loc?.start.line ?? 0, owner: null } : null;
  }

  let hit = null;
  const visit = (node, root = false) => {
    if (!node || typeof node !== 'object' || hit) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    // A nested closure has its own `this` contract. It cannot define the public
    // instance method of the constructor we are resolving.
    if (
      !root &&
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression')
    )
      return;
    if (
      node.type === 'AssignmentExpression' &&
      node.operator === '=' &&
      node.left?.type === 'MemberExpression' &&
      !node.left.computed &&
      node.left.object?.type === 'ThisExpression' &&
      node.left.property?.type === 'Identifier' &&
      node.left.property.name === memberName &&
      (node.right?.type === 'FunctionExpression' ||
        node.right?.type === 'ArrowFunctionExpression')
    ) {
      // `owner` is the constructor whose scope this member closes over. The member's
      // dependencies are declared THERE, not in its own body, so a caller that scans
      // the member without it resolves none of its receivers (kernel/bindings.js).
      hit = { fn: node.right, line: node.right.loc?.start.line ?? 0, owner: direct };
      return;
    }
    for (const key of Object.keys(node)) {
      if (
        key === 'loc' ||
        key === 'range' ||
        key === 'leadingComments' ||
        key === 'trailingComments'
      )
        continue;
      const child = node[key];
      if (child && typeof child === 'object') visit(child);
    }
  };
  visit(direct.body, true);
  return hit;
}

function commonJsEntrypoint(mod) {
  for (const node of mod.ast?.program.body ?? []) {
    const assignment =
      node.type === 'ExpressionStatement' &&
      node.expression?.type === 'AssignmentExpression'
        ? node.expression
        : null;
    const left = assignment?.left;
    if (
      !assignment ||
      left?.type !== 'MemberExpression' ||
      left.computed ||
      left.object?.type !== 'Identifier' ||
      left.object.name !== 'module' ||
      left.property?.type !== 'Identifier' ||
      left.property.name !== 'exports'
    )
      continue;
    const right = assignment.right;
    if (right.type === 'Identifier') return mod.functions.get(right.name)?.node ?? null;
    if (right.type === 'FunctionExpression' || right.type === 'ArrowFunctionExpression')
      return right;
  }
  return null;
}

// varName → { className, args } for every `const svc = new X(…)` (or `svc = new X(…)`)
// in the subtree — the raw material of instantiated-service resolution. `args` feeds
// the cross-class symbolic dataflow (a request-derived constructor arg → this.<field>).
function collectInstances(fnNode) {
  const map = new Map();
  walkAst(fnNode, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init?.type === 'NewExpression' &&
      node.init.callee.type === 'Identifier'
    )
      map.set(node.id.name, {
        className: node.init.callee.name,
        args: node.init.arguments,
      });
    else if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'Identifier' &&
      node.right?.type === 'NewExpression' &&
      node.right.callee.type === 'Identifier'
    )
      map.set(node.left.name, {
        className: node.right.callee.name,
        args: node.right.arguments,
      });
  });
  return map;
}

// Interprocedural taint seed (ADR-066): the callee params the caller proved request-derived.
// For `helper(a, b)`, param i is tainted when arg i resolves to a request member in the
// caller's scope (`reqParamName` non-null). Identifier params only — a destructured helper
// signature is left to the callee's own body scan. MUST-analysis (only a proven-tainted arg
// seeds), so it can only sharpen a finding, never fabricate one. Returns Map or null.
function seedTaint(fn, args, callerReq, hop = null) {
  if (!fn?.params?.length || !args?.length) return null;
  let seed = null;
  const seedOrigins = new Map();
  const seedSteps = new Map();
  const ensure = () => {
    if (!seed) {
      seed = new Map();
      Object.defineProperty(seed, 'origins', {
        value: seedOrigins,
        enumerable: false,
      });
      Object.defineProperty(seed, 'steps', { value: seedSteps, enumerable: false });
    }
    return seed;
  };
  // TAPP-2 gate. The ORIGIN has crossed this seam since ADR-066 and keeps its
  // behaviour untouched below; what is new is the STEP, and a step is a claim
  // about WHICH value landed in WHICH parameter. That claim needs the position to
  // be unambiguous for the whole call, so these two disqualify the entire seam
  // rather than one parameter: a spread makes every later position unknowable,
  // and a rest parameter changes what "position i" means.
  const positional =
    hop != null &&
    !args.some((a) => a?.type === 'SpreadElement') &&
    !fn.params.some((p) => p?.type === 'RestElement') &&
    new Set(fn.params.map((p) => (p?.type === 'Identifier' ? p.name : null))).size ===
      fn.params.length;
  fn.params.forEach((p, i) => {
    const id = p.type === 'TSParameterProperty' ? p.parameter : p;
    if (id?.type !== 'Identifier') return;
    const arg = args[i];
    if (!arg) return;
    const marker = reqParamName(arg, callerReq, null);
    // The ORIGIN crosses the call boundary with the taint. Without it a DAO that
    // receives `req.params.userId` as its first parameter knows the value is
    // request-derived but not WHICH surface it came from — and "a client-chosen
    // id reached this filter" is a different statement from "some request value
    // reached this filter". `origin` is what makes the first one sayable.
    const origin = requestOriginOf(arg, callerReq?.origins);
    if (marker != null) {
      ensure().set(id.name, marker);
      if (origin) seedOrigins.set(id.name, origin);
    } else if (origin) {
      // an origin with no symbolic marker still binds the parameter
      ensure();
      seedOrigins.set(id.name, origin);
    }
    if (!origin || !positional) return;
    // The caller's own steps, which only the caller can state — this parameter's
    // body has no view of the handler that filled it.
    const before =
      arg.type === 'Identifier'
        ? localChain(arg.name, callerReq)
        : requestOriginOf(arg, callerReq?.origins)
          ? []
          : null;
    if (before === null) return;
    // A parameter the callee REBINDS is not the value that was passed. Refusing
    // here is the difference between recording a journey and asserting one: the
    // effect below may read `tag` after `tag = 'constant'`, and a path that
    // claimed the client chose it would be precisely wrong.
    if (paramRebound(fn, id.name)) return;
    ensure();
    seedSteps.set(id.name, {
      via: 'parameter',
      from: null,
      hop: [...before, `${hop}(#${i})`],
      line: arg.loc?.start.line ?? 0,
    });
  });
  return seed;
}

// Is this parameter name written to, re-declared, or shadowed anywhere in the
// callee body? Deliberately coarse — one conservative `true` costs a declared
// boundary, while one missed rebinding states a path the program does not take.
function paramRebound(fn, name) {
  let rebound = false;
  walkAst(fn.body, (node) => {
    if (rebound) return;
    if (
      (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') &&
      (node.left ?? node.argument)?.type === 'Identifier' &&
      (node.left ?? node.argument).name === name
    )
      rebound = true;
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.id.name === name
    )
      rebound = true;
    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      (node.params ?? []).some((p) => p?.type === 'Identifier' && p.name === name)
    )
      rebound = true;
  });
  return rebound;
}

// One engine instance per extract run. `scannedFiles` and `helpers` are the
// extractor's own arrays — the engine appends to them as it discovers files and
// dead-path candidates, exactly like the code it replaced. Both memo caches
// live here, scoped to the run.
// ADR-105 — the Nest request surfaces a controller method declares, as a taint
// seed the callee can read. `@Body() dto` is not `req.body`: the parameter name
// is arbitrary and `REQ_ROOTS` cannot see it, which is why every Nest occurrence
// on every measured application carried `dataOrigins: []`.
//
// The surface itself is proved by `surfaceOfParameter` — the SAME function the
// TAPP pass uses, so the two layers cannot disagree about what a source IS, and
// the decorator's provenance is resolved to `@nestjs/common` rather than matched
// by name. A pipe stays IN the path: TAPP-1 decided a normalizer does not launder
// provenance, and `@Param('id', ParseUUIDPipe)` is that rule at the decorator.
//
// → a seed shaped exactly like `collectReqDerived`'s output, or null.
export function nestSurfaceSeed(method, mod) {
  const origins = new Map();
  const steps = new Map();
  for (const p of method?.params ?? []) {
    const s = surfaceOfParameter(p, mod);
    if (!s) continue;
    origins.set(s.param, { origin: s.origin, name: s.name });
    steps.set(s.param, {
      via: 'parameter',
      from: null,
      hop: [s.name ? `req.${s.origin}.${s.name}` : `req.${s.origin}`, ...s.pipes],
      line: p.loc?.start.line ?? 0,
    });
  }
  if (!origins.size) return null;
  // The marker map stays EMPTY on purpose. A marker is what `valueTainted` reads,
  // and a decorated parameter is a SOURCE, not a proof that the body mutates with
  // it; the origins and the steps are the evidence this slice adds, and leaving
  // the markers alone is what keeps it from moving a taint flag it did not earn.
  const seed = new Map();
  Object.defineProperty(seed, 'origins', { value: origins, enumerable: false });
  Object.defineProperty(seed, 'steps', { value: steps, enumerable: false });
  return seed;
}

export function createResolver({
  cwd,
  scannedFiles,
  helpers,
  kernel = null,
  // ADR-105. `() => Map<`${controllerFile}#${Class}`, Map<field, {file,name}>>`,
  // memoized by the caller and called at most once. A resolver constructed
  // without it — every lowering but Nest — behaves exactly as before, and so does
  // a Nest application whose map comes back EMPTY. That equivalence is the blast
  // radius, and it is checkable rather than argued.
  provedBindings = null,
}) {
  const classBundles = new Map(); // memo: per (class file, class.method[, symbols])
  const orphanBodies = new WeakSet(); // bodies already declared owner-less, deduped
  const classLookups = new Map(); // memo: per (module, class name) — barrel walks
  const rel = (abs) => relOf(cwd, abs);
  const EMPTY_CAPTURE = captureChain([]);

  // ADR-105. The module-literal binding for `this.<field>` of the class this walk
  // is currently inside, or null. Read through the caller's memo, so the module
  // set is walked at most once per compile; a lowering that supplies none — every
  // one but Nest — gets `null` here and every branch below behaves as before.
  //
  // ONLY a controller is ever in this map, which is what keeps V1 to the single
  // controller -> provider hop: a service's own `this.repository` is a second
  // question with a second proof, and it is not asked here.
  let bindingMemo;
  const provedFieldsOf = (mod, cls) => {
    if (!provedBindings) return null;
    const file = mod?._file;
    const name = cls?.id?.name;
    if (!file || !name) return null;
    bindingMemo ??= provedBindings() ?? new Map();
    return bindingMemo.get(`${file}#${name}`) ?? null;
  };
  const nestBinding = (clsCtx, field) =>
    provedFieldsOf(clsCtx?.declMod, clsCtx?.declCls)?.get(field) ?? null;

  // Hard rule 9, applied to RESOLUTION rather than registration: a receiver the
  // walk could not bind used to end in a bare `return`, leaving no route, no skip
  // and no unknown handler — the loss shape that lets a real endpoint earn a
  // clean read. Every such stop is now a fact with a named cause.
  const unknown = (file, line, symbol, uncertainty, detail, owner = null, pkg = null) => {
    if (!kernel) return;
    record(
      kernel,
      makeFact(
        'UnknownBoundary',
        factId('UnknownBoundary', file, line, `${symbol}:${uncertainty}`),
        // `owner` is the body being resolved when the walk stopped. `lift` maps it
        // to the UBG node that owns that body, so a boundary is attached to the
        // path it sits on rather than floating beside the graph.
        //
        // `specifier`/`pkg` are FIRST-CLASS, not prose inside `detail`: the root
        // cause of a workspace stop is one package, and grouping a hundred stops by
        // it must not require parsing an English sentence.
        {
          symbol,
          detail,
          owner,
          ...(pkg ? { specifier: pkg.specifier, pkg: pkg.pkg } : {}),
        },
        { file, line, symbol, contract: 'node/resolve', uncertainty },
      ),
    );
  };

  // A name that failed to bind BECAUSE the workspace package it came from could not
  // be opened. Distinguishing this from "no binding anywhere" is the whole point:
  // the first is one package away from being resolvable, the second is unlocatable.
  const workspaceMiss = (mod, name) => mod?.unresolvedWorkspace?.get(name) ?? null;

  // ---- member-call following (imports, instantiated services, this/super) ----
  //
  // A handler's real effects = its own body PLUS every module-member call it makes,
  // followed recursively: `authController.register` → `userService.createUser` →
  // `User.create()`. This is the CommonJS analogue of the Nest DI hop — the effect is
  // usually two or three modules below the route, behind `service.method()` calls the
  // flat scanner can't see. Precomputed so translate uses it as-is.
  //
  // The same walk also resolves INSTANTIATED services — `const svc = new XService(…);
  // svc.readMany(…)` (directus and every class-service Express app) — through the
  // class's `extends` chain, including `this.<m>()` / `super.<m>()` hops inside the
  // resolved methods. `this.<m>()` dispatches from the INSTANTIATED class, so an
  // override (ActivityService.readByQuery) wins over the base method it shadows.
  // `captured` is the chain of enclosing scopes this body closes over. For a
  // handler installed by a constructor (`this.display = (req,res) => …`) every
  // dependency it calls is declared in that constructor, so without the chain the
  // body scans to nothing at all — silently.
  // The identity of the body being resolved, in THE canonical form (`schema.js`
  // `bodyKey`) — the same one the compiler uses to key its `logic:`/`guard:` nodes.
  // It used to be a local `<file>#<line>` concatenation, which named no symbol and
  // therefore could not equal any node id: cal.com produced 2816 boundaries and
  // exactly 0 that joined the graph (E-109).
  //
  // `name` is the symbol the compiler will register for this body — a helper's
  // `Class.method`, a controller method's own name. A body the compiler will not
  // register at all has no identity to share, and `null` says so: it becomes a
  // `missing-owner-provenance` boundary rather than a silently unattached stop.
  const ownerKeyOf = (mod, fnNode, name) => {
    if (!mod?._file || !name) return null;
    return bodyKey(rel(mod._file), name, fnNode?.loc?.start.line ?? 0);
  };

  // A stop the walk made inside a body the compiler never turned into a node. The
  // stop is REAL; only its address is missing, and dropping it because the address
  // is missing is the loss shape hard rule 9 forbids one level in.
  const orphanOwner = (file, line, symbol) => {
    unknown(
      file,
      line,
      symbol,
      'missing-owner-provenance',
      'the body performing this call has no compiler-registered identity, so the stop cannot be attached to a route',
      null,
    );
  };

  // `owner` is the NAME the caller will register this body under — the same
  // string it puts in its chain step, which is what `translate` turns into the
  // node. The resolver cannot derive it: an Express handler is usually an
  // anonymous arrow, and its identity lives in the registration, not in the body.
  function deepScan(fnNode, owningMod, { captured = EMPTY_CAPTURE, owner = null } = {}) {
    const base = stampDeclaringFile(
      scanFunction(fnNode, {
        effectClients: owningMod?.effectClients,
        dbHandles: owningMod?.dbHandles,
        nonDbHandles: owningMod?.nonDbHandles,
        collections: capturedCollections(fnNode, captured),
      }),
      owningMod?._file ? rel(owningMod._file) : null,
    );
    const merged = {
      ...base,
      effects: [...base.effects],
      returnShapes: [...(base.returnShapes ?? [])],
      calls: [...(base.calls ?? [])],
    };
    followCalls(
      fnNode,
      owningMod,
      merged,
      new Set(),
      0,
      null,
      new Set(),
      null,
      captured,
      ownerKeyOf(owningMod, fnNode, owner ?? fnNode?.id?.name ?? null),
    );
    return merged;
  }

  // A body sees its OWN collection handles plus every captured one. Own bindings
  // win: an inner `const col = db.collection('x')` shadows the outer binding, the
  // same way the language resolves it.
  function capturedCollections(fnNode, captured) {
    const own = scopeBindings(fnNode).collections;
    const merged = new Map();
    for (const scope of captured.scopes ?? [])
      for (const [name, handle] of scope.collections) merged.set(name, handle);
    for (const [name, handle] of own) merged.set(name, handle);
    return merged.size ? merged : null;
  }

  // `seen` dedups sub-scans merged into THIS target; `stack` is the class-method
  // cycle guard and spans the whole recursion; `clsCtx` (top + declaring class) is
  // set while walking a class-method body so `this.` / `super.` calls resolve.
  function followCalls(
    fnNode,
    mod,
    merged,
    seen,
    depth,
    clsCtx,
    stack,
    taintSeed = null,
    captured = EMPTY_CAPTURE,
    ownerKey = null,
  ) {
    const here = mod?._file ? rel(mod._file) : '<unknown>';
    // An owner-less walk is not an error, it is a MEASUREMENT GAP, and it must be
    // visible as one: every stop this walk records would otherwise be unattachable
    // to any route, which reads downstream exactly like "this body stopped
    // nowhere". Declared once per body rather than once per stop, so an orphan
    // family is one countable cause instead of thousands of rows.
    if (kernel && !ownerKey && !orphanBodies.has(fnNode)) {
      orphanBodies.add(fnNode);
      orphanOwner(here, fnNode?.loc?.start.line ?? 0, '<body>');
    }
    if (depth >= MAX_RESOLVE_DEPTH) {
      // The bound is real and load-bearing (E-027), but stopping at it is a
      // measurement gap, not a completed walk. Say so.
      unknown(
        here,
        fnNode?.loc?.start.line ?? 0,
        '<depth>',
        'depth-budget',
        `the walk stopped at the depth bound (${MAX_RESOLVE_DEPTH})`,
        ownerKey,
      );
      return;
    }
    const instances = collectInstances(fnNode);
    const nestedFns = localFunctions(fnNode);
    // this body's request-derived vars, INCLUDING params the caller proved tainted
    // (interprocedural taint, ADR-066) — used to seed a bare helper this body calls.
    const callerReq = collectReqDerived(fnNode, taintSeed);
    walkCalls(fnNode, (node) => {
      const callee = node.callee;
      // bare imported/local function call: `helper(args)`. The resolver historically only
      // followed `x.method()`, so an effect — or an ownership scope — inside a bare helper
      // (`getCustomerOrThrow({ workspaceId })`) was invisible: it capped taint, BOLA, and
      // coverage. Follow it too — resolve to a local function (`mod.functions`) or an
      // imported one (through barrel re-exports), scan + recurse, memoized via `seen`,
      // depth-bounded. Safe since E-042: a called helper's NAME can no longer fabricate a
      // guard, so following a helper named `mapUserAdmin` can't hide a real finding.
      if (callee.type === 'Identifier') {
        const name = callee.name;
        let fn = null;
        let fnMod = mod;
        const local = mod.functions.get(name);
        // A function declared INSIDE this body is invisible to `mod.functions`,
        // which only records top-level declarations. Checked before the import
        // lookup so a nested helper shadows a same-named import, as the language
        // resolves it.
        const nested = nestedFns.get(name);
        if (local) {
          fn = local.node;
        } else if (nested) {
          fn = nested;
        } else {
          const file = mod.imports.get(name);
          if (file) {
            const hit = resolveExportedFunction(parseModule(file), name);
            if (hit) {
              fn = hit.fn.node;
              fnMod = hit.mod;
            }
          }
        }
        if (!fn) {
          // A bare call that resolved to nothing. Three different states, and
          // collapsing them would make the ledger uncountable: a global/host
          // function is inert; an import present with no readable export is a
          // real gap; anything else is a binding the walk never saw.
          if (!isInertReceiver(name) && !GLOBAL_FUNCTIONS.has(name)) {
            const imported = mod.imports.has(name);
            // A workspace miss OUTRANKS the generic causes: `unresolved-alias` says
            // the name binds to nothing, which is false and unactionable here — it
            // binds to a package that exists and did not open.
            const miss = !imported ? workspaceMiss(mod, name) : null;
            unknown(
              here,
              node.loc?.start.line ?? 0,
              name,
              miss
                ? 'unresolved-workspace-module'
                : handsOverCallback(node)
                  ? 'opaque-callback'
                  : imported
                    ? 'unresolved-export'
                    : 'unresolved-alias',
              miss
                ? `${name}() comes from the workspace package ${miss.pkg} (${miss.specifier}), which the scan could not open`
                : handsOverCallback(node)
                  ? `a continuation is handed to ${name}(), which did not resolve — whether and when it runs is unknown`
                  : imported
                    ? `imported ${name} is not a readable exported function`
                    : `bare call ${name}() has no local or imported binding`,
              ownerKey,
              miss,
            );
          }
          return;
        }
        if (fn) {
          // ADR-074 V2 — interprocedural ownership witness: the compare+deny lives in
          // THIS resolved helper, the identity binding at THIS call site (`assertOwner(
          // row.ownerId, req.user.id)`). Checked per call site — the `seen` dedup below
          // is per helper, and a later call with the right bindings must still count.
          // Advisory-only (O7), never a guard: `bare.guardSignals` stays stripped below.
          if (!merged.ownerAsserted && callBindsOwnershipWitness(node, fn))
            merged.ownerAsserted = true;
          const key = `bare:${fnMod._file ?? ''}#${name}`;
          if (!seen.has(key)) {
            seen.add(key);
            const fromRel = rel(fnMod._file ?? '');
            if (!scannedFiles.includes(fromRel)) scannedFiles.push(fromRel);
            // A bare helper contributes its EFFECTS (coverage, object-scope) but NEVER a
            // guard: it is NOT registered as a helper node, and its deny signal is stripped
            // before merge. A `throw 403` reached TRANSITIVELY through a bare call does not
            // gate the caller's route — attributing it would fabricate a guard (novu's
            // `assertIntegrationEnvironmentScope` gating a public register → a false PROVEN).
            // A route's real gate is a chain step or a DIRECTLY-resolved verifier, not any
            // denying function somewhere in its transitive closure. Effects merge; guards do not.
            // interprocedural taint (ADR-066): bind the helper's params the caller proved
            // request-derived (`saveItem(req.body)` → `saveItem`'s first param is tainted),
            // so a write inside the helper carries the taint. MUST-analysis, so it only
            // sharpens a finding, never fabricates one.
            const calleeSeed = seedTaint(fn, node.arguments, callerReq, name);
            const bare = stampDeclaringFile(
              scanFunction(fn, {
                effectClients: fnMod?.effectClients,
                dbHandles: fnMod?.dbHandles,
                nonDbHandles: fnMod?.nonDbHandles,
                reqDerivedSeed: calleeSeed,
              }),
              fromRel,
            );
            bare.guardSignals = { deniesWithStatus: false };
            mergeScan(merged, bare);
            followCalls(
              fn,
              fnMod,
              merged,
              seen,
              depth + 1,
              null,
              stack,
              calleeSeed,
              EMPTY_CAPTURE,
              ownerKey,
            );
          }
        }
        return;
      }
      if (callee.type !== 'MemberExpression') return; // not a call we model at all
      // `obj[expr]()` — COMPUTED is what makes it dynamic, not the node type of
      // the property: a computed `obj[op]()` has an Identifier property too, and
      // reading its name would silently invent the method `op`.
      const computedMember = callee.computed && callee.property.type !== 'StringLiteral';
      if (callee.property.type !== 'Identifier' || computedMember) {
        // `obj[expr]()` — the method name is not statically readable, so whatever
        // it does is invisible. Exactly the shape ADR-068 named for writes.
        unknown(
          here,
          node.loc?.start.line ?? 0,
          calleeRootName(callee) ?? '<computed>',
          'dynamic-member',
          'the called member name is computed and not statically readable',
          ownerKey,
        );
        return;
      }
      const method = callee.property.name;
      const obj = callee.object;

      // instantiated service: `svc.method()` where `const svc = new X(…)`, the
      // direct `new X(…).method()` chain, or — the pre-class Node idiom — an
      // instance CAPTURED from the enclosing constructor scope.
      const inst =
        obj.type === 'Identifier' && instances.has(obj.name)
          ? instances.get(obj.name)
          : obj.type === 'Identifier' && captured.instance(obj.name)
            ? captured.instance(obj.name)
            : obj.type === 'NewExpression' && obj.callee.type === 'Identifier'
              ? { className: obj.callee.name, args: obj.arguments }
              : null;
      if (inst) {
        // cross-class symbolic dataflow: a request-derived constructor arg
        // (`new ItemsService(req.params.collection, …)`) binds `this.collection`
        // for every method of the instance.
        const thisSymbols = classThisSymbols(inst, mod, fnNode, clsCtx);
        const bundle = classBundle(
          inst.className,
          method,
          mod,
          depth,
          stack,
          thisSymbols,
        );
        if (bundle) {
          if (!seen.has(bundle.key)) {
            seen.add(bundle.key);
            mergeScan(merged, bundle);
          }
          return;
        }
        // A CommonJS constructor function is not a class, so the class walk above
        // finds nothing. `function Dao(db){ this.find = () => … }` is the shape
        // most of pre-2018 Node is written in, and it carries its dependencies in
        // the constructor's scope — which is exactly what the capture chain is.
        const cjs = commonJsInstanceBundle(
          inst,
          method,
          mod,
          depth,
          stack,
          captured,
          seedTaint(
            resolveInstanceMember(
              mod.imports.get(inst.className)
                ? parseModule(mod.imports.get(inst.className))
                : mod,
              inst.className,
              method,
            )?.fn,
            node.arguments,
            callerReq,
            // The hop, named by the two things that were RESOLVED to reach it:
            // the instance's class and the member. Never the receiver variable —
            // `benefitsDAO` is a local alias, and a path that named it would read
            // as evidence about a name rather than about a resolved body.
            `${inst.className}.${method}`,
          ),
        );
        if (cjs) {
          if (!seen.has(cjs.key)) {
            seen.add(cjs.key);
            mergeScan(merged, cjs);
          }
          return;
        }
        const instanceReachable =
          Boolean(mod.imports.get(inst.className)) ||
          Boolean(mod.functions.get(inst.className));
        // The receiver IS a known instance and the member still did not resolve:
        // a real behavioural hop that ends here. This is the fact that keeps the
        // route from reading clean by omission.
        unknown(
          here,
          node.loc?.start.line ?? 0,
          `${inst.className}.${method}`,
          // "the module opened and the member is not there" and "the scope that
          // declares this instance cannot be opened at all" are different states.
          // The second hides a whole dependency rather than one method.
          instanceReachable ? 'unresolved-module' : 'unreachable-capture',
          instanceReachable
            ? `instance member ${method} not found on ${inst.className}`
            : `${inst.className} is captured from a scope the walk cannot open — its whole surface is unmeasured`,
          ownerKey,
        );
        return;
      }

      // constructor-type DI: `this.<prop>.<m>()` where <prop> is a dependency in
      // the class's DI map (its own constructor params + every ancestor's, each
      // tagged with the module that declared it). The Nest hop, now one receiver
      // kind of the same walk — the dependency's class resolves like any other.
      if (
        clsCtx?.di &&
        obj.type === 'MemberExpression' &&
        obj.object.type === 'ThisExpression' &&
        obj.property.type === 'Identifier'
      ) {
        const dep = clsCtx.di[obj.property.name];
        if (!dep) {
          unknown(
            here,
            node.loc?.start.line ?? 0,
            `this.${obj.property.name}.${method}`,
            'unresolved-receiver',
            `this.${obj.property.name} is not a declared constructor dependency`,
            ownerKey,
          );
          return;
        }
        // ADR-105 — the ONE place a request surface crosses a class boundary.
        // The type in `dep.type` resolved the dependency well enough to
        // over-approximate its EFFECTS, and it does not say which class the
        // container binds. So a seed is built only when the SOURCE settles it: a
        // literal @Module naming this controller and this provider, both reached
        // by exact relative imports, unambiguous, undecorated, and declared by
        // the file they resolve to (`provedProviderBindings`).
        //
        // `proved.file` is then checked against the file the walk actually
        // opened. Without that, a module literal proving `UserService` would seed
        // a bundle the type resolution had taken somewhere else — the two
        // mechanisms agreeing by coincidence rather than by construction.
        const provedField = nestBinding(clsCtx, obj.property.name);
        const diSeed =
          provedField && provedField.name === dep.type
            ? seedTaint(
                methodInClassChain(
                  classInModule(parseModule(provedField.file), provedField.name),
                  parseModule(provedField.file),
                  method,
                )?.fn,
                node.arguments,
                callerReq,
                `${provedField.name}.${method}`,
              )
            : null;
        const bundle = classBundle(
          dep.type,
          method,
          dep.mod,
          depth,
          stack,
          null,
          provedField ? diSeed : null,
          provedField?.file ?? null,
        );
        if (!bundle) {
          // The DI shape of the same cause: the dependency's TYPE is imported from a
          // workspace package that did not open, so the whole injected surface is
          // unmeasured — not merely "this type has no such method".
          const miss = workspaceMiss(dep.mod, dep.type);
          unknown(
            here,
            node.loc?.start.line ?? 0,
            `${dep.type}.${method}`,
            miss ? 'unresolved-workspace-module' : 'unresolved-type',
            miss
              ? `dependency type ${dep.type} comes from the workspace package ${miss.pkg} (${miss.specifier}), which the scan could not open`
              : `dependency type ${dep.type} did not resolve to a class with ${method}`,
            ownerKey,
            miss,
          );
          return;
        }
        if (!seen.has(bundle.key)) {
          seen.add(bundle.key);
          mergeScan(merged, bundle);
        }
        return;
      }

      // inside a resolved class method: this.<m>() re-dispatches from the top
      // (instantiated) class; super.<m>() from the declaring class's base — both keep
      // the instance's symbolic bindings so this.<field> stays resolved across hops
      if (clsCtx && obj.type === 'ThisExpression') {
        const bundle = classMethodBundle(
          clsCtx.topCls,
          clsCtx.topMod,
          method,
          depth,
          stack,
          clsCtx.thisSymbols,
        );
        if (!bundle) {
          unknown(
            here,
            node.loc?.start.line ?? 0,
            `this.${method}`,
            'unresolved-export',
            `${method} is not declared anywhere on the instantiated class chain`,
            ownerKey,
          );
          return;
        }
        if (!seen.has(bundle.key)) {
          seen.add(bundle.key);
          mergeScan(merged, bundle);
        }
        return;
      }
      if (clsCtx && obj.type === 'Super') {
        const base = baseClassOf(clsCtx.declCls, clsCtx.declMod);
        const bundle = base
          ? classMethodBundle(
              base.cls,
              base.mod,
              method,
              depth,
              stack,
              clsCtx.thisSymbols,
            )
          : null;
        if (!bundle) {
          unknown(
            here,
            node.loc?.start.line ?? 0,
            `super.${method}`,
            base ? 'unresolved-export' : 'unresolved-type',
            base
              ? `${method} is not declared on the base class chain`
              : 'the base class of this declaration did not resolve',
            ownerKey,
          );
          return;
        }
        if (!seen.has(bundle.key)) {
          seen.add(bundle.key);
          mergeScan(merged, bundle);
        }
        return;
      }

      if (obj.type !== 'Identifier') {
        // A chained receiver (`a.b.c()`, `dao.find().then(…)`). If its ROOT is
        // inert, or is a binding the walk already resolved, the chain is the
        // language or a continuation — both modelled elsewhere. Otherwise the hop
        // genuinely ends without a target.
        const root = calleeRootName(callee);
        const rootResolved =
          root != null &&
          (isInertReceiver(root) ||
            instances.has(root) ||
            Boolean(captured.instance(root)) ||
            mod.imports.has(root) ||
            Boolean(capturedCollections(fnNode, captured)?.has(root)));
        if (!rootResolved)
          unknown(
            here,
            node.loc?.start.line ?? 0,
            `${root ?? '<expr>'}.${method}`,
            'unresolved-receiver',
            'the receiver is an expression with no structural binding',
            ownerKey,
          );
        return;
      }
      const targetFile = mod.imports.get(obj.name);
      if (!targetFile) {
        // Not an import. Either a language/host object (inert, classified), or a
        // local binding the walk never resolved — which IS a stop worth counting.
        if (
          !isInertReceiver(obj.name) &&
          !instances.has(obj.name) &&
          !captured.instance(obj.name) &&
          // A captured collection handle IS resolved — by the mongo/driver
          // contract, which already emitted the effect. Calling it unknown here
          // would have the ledger contradict the graph it describes.
          !capturedCollections(fnNode, captured)?.has(obj.name)
        ) {
          // Same precedence as the bare-call arm: the package is the root cause,
          // and it is what a hundred dependent routes have in common.
          const miss = workspaceMiss(mod, obj.name);
          unknown(
            here,
            node.loc?.start.line ?? 0,
            `${obj.name}.${method}`,
            miss
              ? 'unresolved-workspace-module'
              : QUEUE_VERBS.has(method)
                ? 'unresolved-queue'
                : handsOverCallback(node)
                  ? 'opaque-callback'
                  : 'unresolved-receiver',
            miss
              ? `${obj.name} comes from the workspace package ${miss.pkg} (${miss.specifier}), which the scan could not open`
              : QUEUE_VERBS.has(method)
                ? `${obj.name}.${method}() pairs a producer or consumer whose other end is not statically resolved`
                : handsOverCallback(node)
                  ? `a continuation is handed to ${obj.name}.${method}(), whose receiver did not resolve`
                  : `${obj.name} is neither an import, an instance, nor a captured binding`,
            ownerKey,
            miss,
          );
        }
        return;
      }
      const targetMod = parseModule(targetFile);
      if (targetMod.error) {
        unknown(
          rel(targetFile),
          node.loc?.start.line ?? 0,
          `${obj.name}.${method}`,
          'unresolved-module',
          `the imported module could not be parsed: ${targetMod.error}`,
          ownerKey,
        );
        return;
      }
      const fn = targetMod.functions.get(method);
      if (!fn) {
        unknown(
          rel(targetFile),
          node.loc?.start.line ?? 0,
          `${obj.name}.${method}`,
          'unresolved-export',
          `${method} is not an exported function of the imported module`,
          ownerKey,
        );
        return;
      }
      const key = `${targetFile}#${method}`;
      if (seen.has(key)) return; // already merged into THIS target — not a stop
      seen.add(key);
      const fromRel = rel(targetFile);
      if (!scannedFiles.includes(fromRel)) scannedFiles.push(fromRel);
      helpers.push({
        name: `${obj.name}.${method}`,
        sourceFile: fromRel,
        sourceLine: fn.line,
        fn: fn.node,
      });
      mergeScan(
        merged,
        stampDeclaringFile(
          scanFunction(fn.node, {
            effectClients: targetMod?.effectClients,
            dbHandles: targetMod?.dbHandles,
            nonDbHandles: targetMod?.nonDbHandles,
          }),
          fromRel,
        ),
      );
      followCalls(
        fn.node,
        targetMod,
        merged,
        seen,
        depth + 1,
        null,
        stack,
        null,
        EMPTY_CAPTURE,
        ownerKey,
      );
    });
  }

  // `const dao = new Dao(db); dao.find(…)` where Dao is a CommonJS constructor
  // FUNCTION rather than a class. `resolveInstanceMember` returns both the member
  // and the constructor that installed it; the constructor's own scope becomes the
  // member's capture chain, which is where its collection handles and sibling DAOs
  // live. Memoized on (declaring file, class, member) like every other bundle, and
  // cycle-guarded through the same `stack`.
  function commonJsInstanceBundle(
    inst,
    methodName,
    mod,
    depth,
    stack,
    captured,
    taintSeed = null,
  ) {
    if (depth >= MAX_RESOLVE_DEPTH) return null;
    const file = mod.imports.get(inst.className);
    const targetMod = file ? parseModule(file) : mod;
    if (!targetMod || targetMod.error) return null;
    const member = resolveInstanceMember(targetMod, inst.className, methodName);
    if (!member?.fn) return null; // the caller declares this as unresolved-module

    const declRel = rel(targetMod._file ?? '');
    // The seed is part of the identity: the same DAO method called once with a
    // request-derived id and once with a constant is two different provenances,
    // and a memo keyed without it would serve the first answer to the second
    // caller. Same rule the class bundle applies to its symbolic bindings.
    const seedSig = taintSeed
      ? '|' +
        [...(taintSeed.origins ?? [])]
          .map(([k, v]) => `${k}=${v.origin}.${v.name ?? '*'}`)
          .sort()
          .join(',')
      : '';
    const key = `cjs:${declRel}#${inst.className}.${methodName}${seedSig}`;
    const cached = classBundles.get(key);
    if (cached) return cached;
    if (stack.has(key)) {
      // A reference cycle contributes nothing by design, which is correct and is
      // still a place the walk stopped carrying behavior.
      unknown(declRel, member.line ?? 0, key, 'cycle', 'reference cycle', key);
      return null;
    }
    stack.add(key);

    // The constructor's scope, plus everything the CALLER already had in scope:
    // a DAO instantiated in the handler's constructor is reachable from the DAO's
    // own methods only through this chain.
    const ownerScope = member.owner ? scopeBindings(member.owner) : null;
    const memberCapture = captureChain([
      ...(ownerScope ? [ownerScope] : []),
      ...(captured.scopes ?? []),
    ]);

    const base = stampDeclaringFile(
      scanFunction(member.fn, {
        effectClients: targetMod.effectClients,
        dbHandles: targetMod.dbHandles,
        nonDbHandles: targetMod.nonDbHandles,
        collections: capturedCollections(member.fn, memberCapture),
        reqDerivedSeed: taintSeed,
      }),
      declRel,
    );
    const bundle = {
      ...base,
      key,
      effects: [...base.effects],
      returnShapes: [...(base.returnShapes ?? [])],
      calls: [...(base.calls ?? [])],
    };
    // A resolved instance method is NOT a guard for its caller: a deny reached
    // transitively through a service call does not gate the route that called it
    // (the rule `mergeScan` already enforces for bare helpers).
    bundle.guardSignals = { deniesWithStatus: false };
    if (!scannedFiles.includes(declRel)) scannedFiles.push(declRel);
    followCalls(
      member.fn,
      targetMod,
      bundle,
      new Set(),
      depth + 1,
      null,
      stack,
      taintSeed,
      memberCapture,
      ownerKeyOf(targetMod, member.fn, `${inst.className}.${methodName}`),
    );
    stack.delete(key);
    classBundles.set(key, bundle);
    return bundle;
  }

  // resolve `new X(args)` → X's `this.<field>` symbol bindings (or null if none of the
  // constructor args are request-derived). `clsCtx.thisSymbols` lets a nested
  // `new Y(this.collection)` inherit the outer instance's symbols.
  function classThisSymbols(inst, mod, callerFn, clsCtx) {
    const file = mod.imports.get(inst.className);
    const clsMod = file ? parseModule(file) : mod;
    if (clsMod.error) return null;
    const cls = classInModule(clsMod, inst.className);
    if (!cls) return null;
    const syms = computeThisSymbols(
      cls,
      clsMod,
      inst.args ?? [],
      callerFn,
      clsCtx?.thisSymbols,
    );
    return syms.size ? syms : null;
  }

  // `new X(…)` → class X (imported, or declared in the same module) → the
  // memoized bundle of X.<methodName>, carrying any symbolic this-bindings.
  function classBundle(
    className,
    methodName,
    mod,
    depth,
    stack,
    thisSymbols,
    seed = null,
    provedFile = null,
  ) {
    const file = mod.imports.get(className);
    const clsMod = file ? parseModule(file) : mod;
    if (clsMod.error) return null;
    const hit = classThroughBarrels(clsMod, className);
    if (!hit) return null;
    // The seed survives only if the body this walk reached is the body the module
    // literal proved. A barrel, an alias or a same-named class in another file
    // resolves here perfectly well and is NOT what the source settled.
    const proved = seed && provedFile && hit.mod?._file === provedFile ? seed : null;
    return classMethodBundle(
      hit.cls,
      hit.mod,
      methodName,
      depth,
      stack,
      thisSymbols,
      proved,
    );
  }

  // A class is looked up THROUGH barrels: declared here, or re-exported from a module
  // this one re-exports. A monorepo package entry point is a barrel and nothing else, so
  // without this every DI hop into a workspace package resolves to nothing at all —
  // silently, since an unresolved hop leaves no trace of its own. Memoized per (module,
  // class): a sixty-line barrel is otherwise re-walked once per hop.
  function classThroughBarrels(clsMod, className) {
    const key = `cls:${clsMod._file ?? ''}#${className}`;
    if (classLookups.has(key)) return classLookups.get(key);
    const hit = resolveExportedClass(clsMod, className);
    classLookups.set(key, hit);
    return hit;
  }

  // The fully-resolved scan of `<topCls>.<methodName>` — its body plus everything
  // reachable below it — memoized per (instantiated class, method) across the whole
  // extract, so a service method reached by N routes is resolved once (same
  // rationale as the DI-path bundleCache; twenty took 34s without it). A bundle is
  // computed with its OWN dedup set, so the memo never stores a partial.
  function classMethodBundle(
    topCls,
    topMod,
    methodName,
    depth,
    stack,
    thisSymbols,
    seed = null,
  ) {
    if (depth >= MAX_RESOLVE_DEPTH) return null;
    const hit = methodInClassChain(topCls, topMod, methodName);
    if (!hit) return null;
    // the memo key includes the symbol binding, so a `:collection`-bound scan and a
    // plain scan of the same method never collide; an empty binding keeps the old key.
    //
    // ADR-105 adds the SEED to that key for exactly the same reason, and it is the
    // difference between evidence and a leak: two routes reaching one service
    // method carry different request surfaces, and a memo keyed without the seed
    // would hand the second route the first route's provenance. `seedSig` is empty
    // for an unseeded scan, so every existing key is unchanged byte for byte.
    const key = `${topMod._file ?? ''}#${topCls.id?.name ?? 'anonymous'}.${methodName}${symSig(thisSymbols)}${seedSig(seed)}`;
    const cached = classBundles.get(key);
    if (cached) return cached;
    if (stack.has(key)) {
      unknown(
        rel(hit.mod._file ?? ''),
        hit.fn.loc?.start.line ?? 0,
        key,
        'cycle',
        'reference cycle',
        key,
      );
      return null;
    }
    stack.add(key);
    // the method is declared by `hit.mod`, which is NOT `topMod` whenever the method
    // comes from a base class — the location has to follow the declaration, not the
    // instantiated class
    const declRel = rel(hit.mod._file ?? '');
    const base = stampDeclaringFile(
      scanFunction(hit.fn, {
        thisSymbols,
        effectClients: hit.mod?.effectClients,
        dbHandles: hit.mod?.dbHandles,
        nonDbHandles: hit.mod?.nonDbHandles,
        // the method's own class supplies the injected/typed repository fields (TypeORM)
        repoFields: collectRepoFields(hit.cls ?? topCls),
        // ADR-105: the request surfaces the caller PROVED land in this body's
        // parameters. `null` everywhere the module literal did not settle the
        // binding, which is every application the map is empty for.
        reqDerivedSeed: seed,
      }),
      hit.mod._file ? declRel : null,
    );
    const bundle = {
      ...base,
      key,
      effects: [...base.effects],
      returnShapes: [...(base.returnShapes ?? [])],
      calls: [...(base.calls ?? [])],
    };
    if (!scannedFiles.includes(declRel)) scannedFiles.push(declRel);
    helpers.push({
      name: `${topCls.id?.name ?? 'anonymous'}.${methodName}`,
      sourceFile: declRel,
      sourceLine: hit.fn.loc?.start.line ?? 0,
      fn: hit.fn,
    });
    followCalls(
      hit.fn,
      hit.mod,
      bundle,
      new Set(),
      depth + 1,
      {
        topCls,
        topMod,
        declCls: hit.cls,
        declMod: hit.mod,
        thisSymbols,
        // di for the NEXT hop is the class's full dependency map (its own
        // constructor params + every ancestor's), each entry tagged with the
        // module that DECLARED it — an inherited repo type resolves against the
        // BASE class's imports, not the subclass's (the immich pattern).
        di: diMapWithMod(topCls, topMod),
      },
      stack,
      null,
      EMPTY_CAPTURE,
      // exactly the triple pushed to `helpers` above, which is what `translate`
      // turns into this body's node — so the key is equal by construction, not by
      // two places agreeing to format a string the same way.
      ownerKeyOf(hit.mod, hit.fn, `${topCls.id?.name ?? 'anonymous'}.${methodName}`),
    );
    stack.delete(key);
    classBundles.set(key, bundle);
    return bundle;
  }

  // A DI-framework handler (a @Controller/@Resolver class method) is just a class
  // method whose class we already know: its effects = its own body + everything the
  // one walk resolves below it — DI hops, instantiated services, imported module
  // calls, this.<m>() sibling dispatch. Real DI apps are DEEP (immich: controller →
  // service → repository → kysely, wiring often inherited), which is why the walk
  // is recursive, bounded, and memoized (E-027: twenty took 34s without the memo).
  function handlerScan(method, di, mod, cls) {
    // ADR-105 — a Nest controller's request surfaces, but ONLY for a controller
    // whose provider bindings the source itself settles. The seed is what lets
    // `@Body() dto` be a source at all; gating it on the module literal is what
    // keeps this slice from claiming a journey through a container decision.
    const surfaces = provedFieldsOf(mod, cls) ? nestSurfaceSeed(method, mod) : null;
    // the handler body itself
    const base = stampDeclaringFile(
      scanFunction(method, {
        effectClients: mod?.effectClients,
        dbHandles: mod?.dbHandles,
        nonDbHandles: mod?.nonDbHandles,
        repoFields: collectRepoFields(cls),
        reqDerivedSeed: surfaces,
      }),
      mod?._file ? rel(mod._file) : null,
    );
    const merged = {
      ...base,
      effects: [...base.effects],
      returnShapes: [...(base.returnShapes ?? [])],
      calls: [...(base.calls ?? [])],
    };
    followCalls(
      method,
      mod,
      merged,
      new Set(),
      0,
      { topCls: cls, topMod: mod, declCls: cls, declMod: mod, thisSymbols: null, di },
      new Set(),
      // ADR-105: the controller's own surfaces are what the DI hop below reads to
      // decide WHICH value landed in WHICH provider parameter. `null` for every
      // controller the module literal did not settle, which is the old behaviour.
      surfaces,
      EMPTY_CAPTURE,
      // The controller method IS the route's handler node, registered by the Nest
      // lowering as `(rel(mod), method.key.name, method.line)`. Passing it here is
      // what lets every stop below a controller reach the route: without it this
      // call site defaulted `ownerKey` to `null`, and the DI path — the deepest
      // walk SPARDA does — produced boundaries nothing could attach.
      ownerKeyOf(mod, method, method?.key?.name ?? null),
    );
    return merged;
  }

  return { deepScan, handlerScan };
}

// a class's full DI map as { prop: { type, mod } }, merged UP the `extends` chain
// (base first so a subclass's own param wins). Each entry carries the module that
// declared it, because that is where its TYPE is imported.
export function diMapWithMod(cls, clsMod) {
  const chain = [];
  let curCls = cls;
  let curMod = clsMod;
  for (let depth = 0; curCls && depth < MAX_RESOLVE_DEPTH; depth++) {
    chain.push({ cls: curCls, mod: curMod });
    const base = baseClassOf(curCls, curMod);
    curCls = base?.cls ?? null;
    curMod = base?.mod ?? null;
  }
  const out = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const { cls: c, mod: m } = chain[i];
    for (const [prop, type] of Object.entries(constructorDI(c)))
      out[prop] = { type, mod: m };
  }
  return out;
}

// constructor(private catsService: CatsService) → { catsService: 'CatsService' }
function constructorDI(cls) {
  const di = {};
  const ctor = cls.body.body.find(
    (m) => m.type === 'ClassMethod' && m.kind === 'constructor',
  );
  for (const param of ctor?.params ?? []) {
    // `private x: T` is a TSParameterProperty wrapping an Identifier with a type
    const id = param.type === 'TSParameterProperty' ? param.parameter : param;
    if (id?.type !== 'Identifier') continue;
    const typeName = typeRefName(id.typeAnnotation?.typeAnnotation);
    if (typeName) di[id.name] = typeName;
  }
  return di;
}

function typeRefName(t) {
  if (!t) return null;
  if (t.type === 'TSTypeReference' && t.typeName?.type === 'Identifier')
    return t.typeName.name;
  return null;
}

// stable signature of a this-symbol binding for the bundle memo key. Empty string
// when there are no symbols, so symbol-free scans keep their original cache key.
// ADR-105 — the seed's identity, for the bundle memo key. A bundle scanned with
// `req.params.id` in parameter 0 is NOT the same result as the same method
// scanned with nothing, and a memo that could not tell them apart would hand the
// second route the first route's provenance — the leak `DbEffectOccurrence` is
// route-scoped to prevent, one layer down.
//
// Empty for an unseeded scan, so every key that exists today is byte-identical.
function seedSig(seed) {
  const origins = seed?.origins;
  if (!origins || origins.size === 0) return '';
  return (
    '|src:' +
    [...origins.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v.origin}.${v.name ?? '*'}`)
      .join(',')
  );
}

function symSig(thisSymbols) {
  if (!thisSymbols || thisSymbols.size === 0) return '';
  return (
    '|' +
    [...thisSymbols.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join(',')
  );
}
