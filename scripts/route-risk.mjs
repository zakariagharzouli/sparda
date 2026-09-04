// route-risk.mjs — the route-scoped risk result, in a form a snapshot can pin.
//
// PR #47 made a real safety result: a route whose DB-effect proof rests on a
// workspace package SPARDA could not open is blocked from PROVEN. Twenty has 73
// such routes. And `npm run corpus` reported **0 drifted**, because the snapshot
// pinned no dimension in which that result appears — so removing the guarantee,
// or silently swapping which routes it covers, would have been invisible to the
// only gate that watches real applications.
//
// A COUNT IS NOT ENOUGH. If 73 blocked routes become 73 DIFFERENT blocked routes,
// the analysis has changed and the number has not. The pinned value is therefore a
// sorted set of `<cause> <route>` pairs, not a total.
//
// Pure on purpose: it takes the blind-spot survey the oracle already computed and
// reshapes it. It does not import the extractor, does not recompile, and does not
// re-derive the analyser's answer a second way — an oracle that reimplements the
// thing it checks is a mirror (ADR-082).
import { cmp } from '../src/ubg/schema.js';

// Lowerings whose interprocedural walk is wired to the kernel ledger. Only these
// can record a resolution stop at all, so only these can HAVE a blocked-route set.
// For the rest the answer is not "none" — it is "not measured", and that
// distinction is the whole of rule 13 at this layer: an empty array here would
// read as a clean bill of health for six lowerings nobody has instrumented.
export const LEDGERED_LOWERINGS = Object.freeze(['express', 'nestjs']);

// `<reason>:<package>` — the root cause a set of routes shares, e.g.
// `unresolved-workspace-module:twenty-shared`. Two different causes must never
// compare equal just because they block the same number of routes.
export const causeKeyOf = (spot) =>
  `${spot.reason ?? 'unknown-cause'}:${spot.label ?? '<unnamed>'}`;

// → { byRisk, blocked, blockedByCause }
//
// `blocked` is `null` when the framework has no ledger — never `[]`. `[]` is an
// ANSWER ("we looked, nothing is blocked"); `null` says there is no answer here.
export function routeRiskOf({ framework, byRisk, spots }) {
  const measured = LEDGERED_LOWERINGS.includes(framework);
  const risk =
    byRisk && typeof byRisk === 'object'
      ? {
          critical: byRisk.critical ?? 0,
          high: byRisk.high ?? 0,
          medium: byRisk.medium ?? 0,
          low: byRisk.low ?? 0,
        }
      : null;
  if (!measured) return { byRisk: risk, blocked: null, blockedByCause: null };

  const dependency = (spots ?? []).filter(
    (s) => s.kind === 'unresolved-dependency' && s.entrypoint,
  );
  // One line per (cause, route). The route id is the canonical entrypoint id the
  // graph already uses — no third identifier format is invented here.
  const blocked = [
    ...new Set(dependency.map((s) => `${causeKeyOf(s)} ${s.entrypoint}`)),
  ].sort(cmp);

  const byCause = {};
  for (const key of blocked) {
    const cause = key.slice(0, key.indexOf(' '));
    byCause[cause] = (byCause[cause] ?? 0) + 1;
  }
  // Sorted at construction: a snapshot compared by `JSON.stringify` must never
  // drift because a Map iterated in a different order.
  return {
    byRisk: risk,
    blocked,
    blockedByCause: Object.fromEntries(
      Object.entries(byCause).sort(([a], [b]) => cmp(a, b)),
    ),
  };
}

// A readable delta for a set-valued metric. The generic `a → b` printer turns a
// 73-element array into an unreadable blob, and a diff nobody reads is a gate
// nobody can act on — which is how this dimension went unpinned in the first place.
export function setDelta(before, after) {
  if (before == null || after == null) return null;
  const a = new Set(before);
  const b = new Set(after);
  return {
    removed: [...a].filter((x) => !b.has(x)).sort(cmp),
    added: [...b].filter((x) => !a.has(x)).sort(cmp),
  };
}

// ---------------------------------------------------------------------------
// TAPP-0 — origin coverage, pinned so it cannot go the way `byRisk` did.
//
// A new dimension that no snapshot records is a dimension the gate cannot defend:
// #47 shipped 73 blocked routes and the corpus printed "0 drifted" because
// nothing pinned them. The same mistake is available here, so the measurement
// lands in the snapshot in the same commit as the measurement itself.
//
// A COUNT IS NOT ENOUGH for the same reason as before: the same number of links
// over DIFFERENT occurrences is a changed analysis. `linked` is therefore a
// sorted SET of `<route> <role> <origin>.<property>` — the canonical entrypoint
// id, the role, and the surface, with no third identifier format invented.
export function originCoverageOf(occurrences) {
  if (!Array.isArray(occurrences)) return null;
  const state = (v) => (v === null ? 'null' : v.length === 0 ? 'empty' : 'linked');
  const counts = {
    occurrences: occurrences.length,
    filter: { linked: 0, empty: 0, unmeasured: 0 },
    data: { linked: 0, empty: 0, unmeasured: 0 },
  };
  const linked = new Set();
  for (const o of occurrences) {
    for (const [role, key] of [
      ['filter', 'filterOrigins'],
      ['data', 'dataOrigins'],
    ]) {
      const v = o[key];
      const s = state(v);
      counts[role][s === 'null' ? 'unmeasured' : s] += 1;
      if (s !== 'linked') continue;
      for (const origin of v)
        linked.add(`${o.entrypoint} ${role} ${origin.origin}.${origin.name ?? '*'}`);
    }
  }
  return { ...counts, linked: [...linked].sort(cmp) };
}

// ---------------------------------------------------------------------------
// TAPP-1 — the ACCESS PATH dimension, pinned in the same commit that produces it.
//
// The rule this repository keeps relearning: a new measurement no snapshot records
// is a measurement the gate cannot defend. #47 shipped 73 blocked routes and the
// corpus printed "0 drifted"; TAPP-0 nearly repeated it. So this lands with the
// engine change, not after it.
//
// THE SET, not the totals, for the third time and the same reason: 9 declared
// boundaries becoming 9 DIFFERENT declared boundaries is a changed analysis, and
// resolved↔unknown flips are exactly the movement that matters — a path that
// silently stops being stated, or one that starts being stated where nothing was
// proven. Both live in one set so the flip shows as a removal AND an addition.
//
// `unmeasuredRoles` is the third state and it is not decoration: without it, a
// "0 resolved" reads as "nothing flows here" when it may mean "no role on this app
// was ever measurable". The two are the whole of rule 13 at this layer.
export function dataFlowCoverageOf(dataFlowFacts, occurrenceFacts) {
  if (!Array.isArray(dataFlowFacts) || !Array.isArray(occurrenceFacts)) return null;
  let unmeasuredRoles = 0;
  for (const o of occurrenceFacts)
    for (const key of ['filterOrigins', 'dataOrigins'])
      if (o[key] === null) unmeasuredRoles += 1;

  const paths = new Set();
  let resolved = 0;
  let unknown = 0;
  for (const f of dataFlowFacts) {
    const source = `${f.source?.origin}.${f.source?.name ?? '*'}`;
    if (f.state === 'resolved') resolved += 1;
    else unknown += 1;
    // The WHOLE path for a resolved fact, not just its endpoints. Pinning
    // `source → destination` was not enough and this was measured, not feared: an
    // interprocedural hop can vanish from the middle while both ends stay
    // identical, and the snapshot read clean over a path that had quietly stopped
    // saying where the value had been. A gate that cannot see the middle cannot
    // defend the capability the middle IS.
    paths.add(
      f.state === 'resolved'
        ? `${f.entrypoint} ${f.role} ${(f.path ?? []).join(' → ')}`
        : `${f.entrypoint} ${f.role} ${source} → UNKNOWN_ACCESS_PATH`,
    );
  }
  return {
    facts: dataFlowFacts.length,
    resolved,
    unknown,
    unmeasuredRoles,
    paths: [...paths].sort(cmp),
  };
}

// ---------------------------------------------------------------------------
// Nest static direct provider V1 — ADR-102, pinned with the change that emits it.
//
// Every pinned giant produces ZERO linkages, and that is exactly why this has to
// be in the snapshot: a dimension whose corpus value is 0 is the one a later
// change can start inventing without anything noticing. The REFUSALS are pinned
// beside the linkages for the same reason — 171 declared boundaries becoming 0
// would mean the grammar stopped looking, which no `linked: []` could show.
//
// `linked` is `null` for a lowering that never runs this pass. `[]` would be an
// answer ("we looked, nothing links"); only `null` says the question was not put.
export const NEST_PROVIDER_LOWERINGS = Object.freeze(['nestjs']);

export function providerLinkageOf({ framework, linkages, boundaries }) {
  if (!NEST_PROVIDER_LOWERINGS.includes(framework))
    return { linked: null, withEffect: null, declined: null, byReason: null };
  const byReason = {};
  for (const b of boundaries ?? []) {
    const r = b.provenance?.uncertainty ?? 'unknown-cause';
    byReason[r] = (byReason[r] ?? 0) + 1;
  }
  const linked = [
    ...new Set(
      (linkages ?? []).map(
        (l) => `${l.entrypoint} ${l.orm} ${l.provider} ${l.op}(${l.entity})`,
      ),
    ),
  ].sort(cmp);
  return {
    linked,
    withEffect: (linkages ?? []).filter((l) => l.effect).length,
    declined: (boundaries ?? []).length,
    byReason: Object.fromEntries(Object.entries(byReason).sort(([a], [b]) => cmp(a, b))),
  };
}
