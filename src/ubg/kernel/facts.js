// ubg/kernel/facts.js — the Node Semantic Kernel fact model.
//
// The kernel answers ONE question structurally:
//
//   HTTP request → route → async → handler/service → Mongo/SQL/ORM → DB effect
//
// It does so by emitting FACTS, never conclusions. A fact is a structural
// observation with a provenance that names who observed it and what remained
// unknown. Five kinds, and no sixth without an ADR:
//
//   AsyncContinuation — a body that runs LATER (await / .then / .catch /
//                       positional Node callback). Carries whether the
//                       continuation is provably reached.
//   DataFlowPath      — TAPP-1: the ordered static steps a request value took to
//                       reach one role of one DB effect, ON ONE ROUTE. Evidence,
//                       never a property: it cannot credit a guard, remove an
//                       effect or move a verdict (ADR-100).
//   DataSource        — where a value came from: body, params, query, session,
//                       or a variable CAPTURED from an enclosing scope.
//   DbEffect          — a read or a write, with its filter, its modified data,
//                       its transaction and its rollback path.
//   ProviderLinkage   — Nest V1: a route→controller→provider→ORM chain proved by
//                       literals and package provenance. Evidence only (ADR-102).
//   GuardBoundary     — a check that is on a route chain, with the four
//                       structural obligations of `guardBoundaryProof`.
//   UnknownBoundary   — the honest one: a place the walk stopped. This is the
//                       fact that makes the other four safe to trust, because
//                       an unresolved hop is RECORDED rather than skipped
//                       (hard rule 9 — modelled or declared, never dropped).
//
// Nothing here decides a verdict. `src/ubg/apocalypse.js` grades; the kernel
// only supplies structure it can prove, and names what it could not.
import { cmp, stableStringify } from '../schema.js';
import { certifyConservation } from '../conservation.js';

export const KERNEL_VERSION = 'sparda-node-kernel/v1';

// The boundary a `DataFlowPath` carries when the value provably reached the role
// and the V1 grammar cannot state HOW. Spelled out as a constant because both the
// producer (`extract.js`) and the lifter must name the same thing, and a boundary
// two modules spell differently is a boundary nobody can count.
export const UNKNOWN_ACCESS_PATH = 'UNKNOWN_ACCESS_PATH';

export const FACT_KINDS = Object.freeze([
  'AsyncContinuation',
  // TAPP-1. Route-scoped like DbEffectOccurrence and for the same reason: the
  // path a value took on route A is not evidence about route B, even when both
  // run the same handler over the same DAO line.
  'DataFlowPath',
  'DataSource',
  'DbEffect',
  // A DbEffect is the canonical OPERATION; an occurrence is what ONE route's
  // path proved about it. Two routes reaching the same DAO line share the
  // operation and must never share the proof: a session identity established on
  // route A cannot license route B, where the same value arrives from the client.
  'DbEffectOccurrence',
  'GuardBoundary',
  // Nest static direct provider V1 (ADR-102). Evidence that a route reaches an
  // ORM operation through a chain proved by LITERALS — a module declaration and
  // official-package provenance — never by a type, a decorator name or a
  // parameter name. It creates no effect and moves no verdict.
  'ProviderLinkage',
  'UnknownBoundary',
]);

const FACT_KIND_SET = new Set(FACT_KINDS);

// Where a request-derived value entered the program. `captured` is the one that
// is not an HTTP surface: it is a binding closed over from an enclosing scope
// (`const col = db.collection('allocations')` used inside an inner arrow), and
// it is exactly the channel NodeGoat's DAO layer travels through.
export const DATA_ORIGINS = Object.freeze([
  'body',
  'params',
  'query',
  'headers',
  'session',
  'captured',
]);

const DATA_ORIGIN_SET = new Set(DATA_ORIGINS);

// Why a fact is not a complete answer. A kernel fact may always carry one; an
// UnknownBoundary MUST. The list is closed so the gap map can aggregate by
// cause instead of by free text — a cause nobody can count is a cause nobody
// fixes (NODE-INTELLIGENCE-GAP-MAP.md).
export const UNCERTAINTY_REASONS = Object.freeze([
  'unresolved-receiver', // `x.m()` where x has no structural binding
  'unresolved-alias', // a bare `f()` whose binding is neither local nor imported
  'unresolved-module', // an import the resolver could not open
  // A specifier that names a package DECLARED IN THIS WORKSPACE and that the scan
  // still could not open. Separate from `unresolved-module` because the root cause
  // is one PACKAGE, not one call: a hundred routes delegating into the same
  // workspace package must group to one cause, not a hundred opaque stops. An
  // external npm dependency is deliberately NOT this reason — see `resolve.js`.
  'unresolved-workspace-module',
  // The walk stopped inside a body the compiler never turned into a node, so the
  // stop is real but has no address. Declared rather than dropped: an unattachable
  // stop reads downstream exactly like a body that never stopped, which is the
  // confusion hard rule 9 exists to prevent.
  'missing-owner-provenance',
  // The walk knew exactly which body it was in, and the compiled graph has no node
  // for that body — the resolver visits more bodies than the compiler registers.
  // Its stops are real and recorded, and they gate nothing: separating this from
  // the joined population is what keeps the new guarantee from over-claiming.
  'owner-not-in-ubg',
  // A Nest provider whose concrete class the CONTAINER decides — a token, a
  // factory, a value, or a registration this grammar cannot read as a literal.
  // Distinct from `unresolved-type` on purpose: the type resolved perfectly well,
  // and it still does not say which class is behind the dependency.
  'unresolved-provider',
  // A value handed to `app.use(...)` that looked like a mounted Express Router and
  // could not be proved one — a dynamic or bare require, a non-router export, an
  // unresolved file, a cycle. It is NOT "no router": an absence and an unprovable
  // mount are the two states this reason keeps apart (ADR-103).
  'unresolved-router-value',
  'unresolved-export', // the module opened, the member is not an exported function
  'unresolved-type', // a DI dependency or class whose type did not resolve
  'dynamic-member', // `obj[expr]()` — the method name is not readable
  'dynamic-target', // a table/collection name that is not a literal
  // TAPP-1: the value provably reached the role and the local access path is not
  // statable in the V1 grammar — a computed member or key, a spread, an array, a
  // call this walk does not open, or a source surface outside body/params/query.
  // It is NOT "no flow": an absence and an unreadable path are the two states
  // this reason exists to keep apart.
  'unknown-access-path',
  'opaque-callback', // a continuation handed to an unresolved callee
  'unresolved-queue', // producer or consumer of an event/queue is not static
  'unreachable-capture', // a receiver captured from a scope the walk cannot open
  'cycle', // a reference cycle: the bundle contributes nothing
  'depth-budget', // the bounded walk stopped before the leaf
  'no-deny-path', // a guard whose refusal is not structurally visible
  'no-allow-path', // a guard whose success does not provably reach the handler
]);

const UNCERTAINTY_SET = new Set(UNCERTAINTY_REASONS);

// A provenance is what separates a fact from an assertion. `contract` names the
// declarative contract that produced it, so a wrong fact is traceable to the
// rule that emitted it rather than to "the analyser".
function normalizeProvenance(raw, factId) {
  if (!raw?.file) throw new Error(`kernel fact ${factId}: provenance needs a file`);
  if (!raw?.contract)
    throw new Error(`kernel fact ${factId}: provenance needs a contract`);
  if (raw.uncertainty != null && !UNCERTAINTY_SET.has(raw.uncertainty))
    throw new Error(`kernel fact ${factId}: unknown uncertainty "${raw.uncertainty}"`);
  return {
    file: raw.file,
    line: raw.line ?? 0,
    symbol: raw.symbol ?? null,
    contract: raw.contract,
    // `null` is "this fact is complete", never "we did not look" — the
    // UnknownBoundary kind carries the second meaning explicitly (rule 13).
    uncertainty: raw.uncertainty ?? null,
  };
}

export function makeFact(kind, id, body, provenance) {
  if (!FACT_KIND_SET.has(kind)) throw new Error(`kernel: unknown fact kind "${kind}"`);
  if (!id) throw new Error(`kernel: fact of kind ${kind} needs an id`);
  if (kind === 'UnknownBoundary' && provenance?.uncertainty == null)
    throw new Error(`kernel fact ${id}: an UnknownBoundary must name its uncertainty`);
  if (kind === 'DataSource' && !DATA_ORIGIN_SET.has(body?.origin))
    throw new Error(`kernel fact ${id}: unknown data origin "${body?.origin}"`);
  // TAPP-1's two states, enforced where they are constructed rather than trusted
  // where they are read. A `resolved` path with nothing in it, or an `unknown`
  // one carrying steps, is the exact shape a reader would act on wrongly — and
  // `path: []` would be a claim ("a path with no steps"), never an admission.
  if (kind === 'DataFlowPath') {
    if (!body?.entrypoint)
      throw new Error(`kernel fact ${id}: a DataFlowPath must name its route`);
    if (body.state === 'resolved') {
      if (!Array.isArray(body.path) || body.path.length === 0)
        throw new Error(`kernel fact ${id}: a resolved DataFlowPath needs its steps`);
    } else if (body.state === 'unknown') {
      if (body.path !== null)
        throw new Error(`kernel fact ${id}: an unknown DataFlowPath states no path`);
    } else throw new Error(`kernel fact ${id}: unknown DataFlowPath state`);
  }
  return {
    kind,
    id,
    ...body,
    provenance: normalizeProvenance(provenance, id),
  };
}

// Deterministic ids. Content-derived like every other id in the UBG, so two
// runs over the same bytes produce the same ledger byte for byte.
export const factId = (kind, file, line, discriminator) =>
  `${kind}:${file}:${line}:${discriminator}`;

// ---------------------------------------------------------------------------
// The ledger — the kernel's conserved output.
// ---------------------------------------------------------------------------

export function createLedger() {
  return { facts: new Map() };
}

export function record(ledger, fact) {
  const existing = ledger.facts.get(fact.id);
  // Ids are content identity: a re-observation of the same structure is the
  // same fact. Merging by id keeps a memoized service body from inflating the
  // ledger when it is reached from several routes.
  if (existing) return existing;
  ledger.facts.set(fact.id, fact);
  return fact;
}

export function ledgerFacts(ledger) {
  return [...ledger.facts.values()].sort((a, b) => cmp(a.id, b.id));
}

// F1 for the kernel: the facts a scan produced must all reach the ledger that
// the graph carries. A contract that observes a DbEffect and then loses it at a
// merge boundary is the same failure class as a pipeline pass deleting a node,
// so it is certified with the same machine and the same equation.
export function certifyKernelConservation({
  pass,
  before,
  after,
  merged = [],
  lost = [],
}) {
  return certifyConservation({
    pass: `kernel:${pass}`,
    factsBefore: before.map((fact) => fact.id),
    factsAfter: after.map((fact) => fact.id),
    nodesIntroduced: after
      .filter((fact) => !before.some((prior) => prior.id === fact.id))
      .map((fact) => ({ id: fact.id })),
    nodesMerged: merged,
    informationLost: lost,
    invariantsPreserved: ['every-kernel-fact-is-recorded-merged-or-declared-lost'],
  });
}

// ---------------------------------------------------------------------------
// The summary that travels with the graph.
// ---------------------------------------------------------------------------

// Every count here is a count of things the kernel SAW. `linked` is the only
// judgement, and it is a conjunction of structural facts, never a heuristic:
// a chain is linked when a DbEffect is reachable from a route through resolved
// hops AND no UnknownBoundary sits on that path.
export function summarizeLedger(ledger) {
  const facts = ledgerFacts(ledger);
  const byKind = Object.fromEntries(FACT_KINDS.map((kind) => [kind, 0]));
  const byUncertainty = {};
  for (const fact of facts) {
    byKind[fact.kind] += 1;
    const reason = fact.provenance.uncertainty;
    if (reason) byUncertainty[reason] = (byUncertainty[reason] ?? 0) + 1;
  }
  return {
    v: KERNEL_VERSION,
    total: facts.length,
    byKind,
    byUncertainty,
    // A LOWER BOUND on the places the walk stopped, never a census: the
    // resolver still has early returns that record nothing, so a zero here is
    // "none was recorded", not "none exists".
    unknownBoundaries: byKind.UnknownBoundary,
    // Rule 13, and the asymmetry that makes it honest: INCOMPLETENESS is
    // provable — one recorded stop proves it — while COMPLETENESS is not, and
    // no completeness oracle exists for this walk yet. So this field is `false`
    // or `null`, and it may never be `true`. Reading a zero count as "the
    // kernel saw everything" is the same move as reading zero findings as
    // "clean" (E-104), one layer down.
    complete: byKind.UnknownBoundary > 0 ? false : null,
    fingerprint: stableStringify(facts.map((fact) => fact.id)),
  };
}

// ---------------------------------------------------------------------------
// GuardBoundary — the four obligations, checked, never assumed.
// ---------------------------------------------------------------------------

// A guard is credited only when all four hold. Each is a separate boolean so a
// partial guard is reported as partial rather than rounded up, and `credited`
// is their conjunction rather than a score anybody could tune.
//
// Nothing here reads a NAME. `denyPathProven` comes from a visible refusal in
// the guard's own body; a middleware called `requireAuth` whose body only calls
// `next()` fails obligation 2 and is not credited (hard rule: no guard
// recognised by its name).
export function guardBoundaryProof({
  onRouteChain,
  denyPathProven,
  allowPathReachesHandler,
  mutationDominated,
}) {
  const obligations = {
    onRouteChain: Boolean(onRouteChain),
    denyPathProven: Boolean(denyPathProven),
    allowPathReachesHandler: Boolean(allowPathReachesHandler),
    mutationDominated: Boolean(mutationDominated),
  };
  const unmet = Object.entries(obligations)
    .filter(([, met]) => !met)
    .map(([name]) => name)
    .sort(cmp);
  return { ...obligations, credited: unmet.length === 0, unmet };
}
