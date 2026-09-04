// ubg/kernel/attach.js — the edge from a body to the stop it made.
//
// Phase A collected the stops; Phase A2 gave them ONE identity (`schema.js`
// `bodyKey`). Neither made them mean anything: no consumer could ask "does this
// route depend on something SPARDA could not read?", because the boundary and the
// node it belongs to were two records with nothing between them.
//
// This module is that something. It stamps each joined boundary onto the OWNING
// node's meta — the same channel `translate` already uses for continuations — so
// the existing route-reachability walk finds it for free. A boundary whose owner
// does NOT correspond to a node is not quietly dropped and not smeared over every
// route: it is re-declared as `owner-not-in-ubg`, once per owner, and counted
// separately. The guarantee this sprint adds covers the joined part only, and
// saying which part that is, out loud, is the point.
import { bodyKeyOfNodeId } from '../schema.js';
import { factId, makeFact, record } from './facts.js';

// Which proof obligations a cause can invalidate. Deliberately NARROW: a cause
// that can hide anything invalidates everything, and a rule that degrades every
// route is indistinguishable from no analysis at all.
//
// Only `unresolved-workspace-module` is load-bearing today. It means an entire
// package of the application's own source was unreadable, so a mutation, a guard
// or an ownership check can be sitting inside it. The other causes stay
// DIAGNOSTIC — they are recorded, counted, and do not gate a verdict yet. That is
// declared debt, not a claim that they are harmless.
export const BOUNDARY_AFFECTS = Object.freeze({
  'unresolved-workspace-module': Object.freeze(['db-effect']),
});

export const affectedProperties = (uncertainty) => BOUNDARY_AFFECTS[uncertainty] ?? [];

// → { attached, orphans, orphanOwners } — counts, so a caller can report the two
// populations separately instead of averaging them into one reassuring number.
export function attachBoundaries(graph, ledger) {
  if (!ledger) return { attached: 0, orphans: 0, orphanOwners: 0 };
  const byBody = new Map();
  for (const node of graph.nodes.values()) {
    if (node.kind !== 'logic' && node.kind !== 'guard') continue;
    byBody.set(bodyKeyOfNodeId(node.id), node);
  }

  let attached = 0;
  let orphans = 0;
  const orphanOwners = new Map(); // owner key → the first fact that named it
  for (const fact of ledger.facts.values()) {
    if (fact.kind !== 'UnknownBoundary') continue;
    // an owner-less stop already declared itself; re-declaring it here would
    // double-count the same admission under a second name
    if (fact.provenance.uncertainty === 'missing-owner-provenance') continue;
    const node = fact.owner ? byBody.get(fact.owner) : null;
    if (!node) {
      orphans += 1;
      if (fact.owner && !orphanOwners.has(fact.owner)) orphanOwners.set(fact.owner, fact);
      continue;
    }
    node.meta.unknownBoundaries ??= [];
    // Dedup on the FACT id only. Two stops that differ in file, line, symbol or
    // cause are two stops; collapsing them because they share an owner would be
    // the merge this ledger exists to prevent.
    if (node.meta.unknownBoundaries.some((b) => b.id === fact.id)) continue;
    node.meta.unknownBoundaries.push({
      id: fact.id,
      reason: fact.provenance.uncertainty,
      symbol: fact.symbol ?? null,
      file: fact.provenance.file,
      line: fact.provenance.line,
      ...(fact.pkg ? { pkg: fact.pkg } : {}),
      ...(fact.specifier ? { specifier: fact.specifier } : {}),
      affects: affectedProperties(fact.provenance.uncertainty),
    });
    attached += 1;
  }

  // Keep the meta deterministic: the ledger iterates in insertion order, which is
  // walk order, and walk order is not part of the contract.
  for (const node of graph.nodes.values())
    if (node.meta.unknownBoundaries)
      node.meta.unknownBoundaries.sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );

  // The orphan population, declared once per owner. `owner-not-in-ubg` says
  // something different from every other cause here: the walk knew exactly where
  // it was, and the graph has no such body — the resolver visits more bodies than
  // the compiler registers. Grouping by owner keeps it countable.
  for (const [owner, fact] of [...orphanOwners].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
    record(
      ledger,
      makeFact(
        'UnknownBoundary',
        factId(
          'UnknownBoundary',
          fact.provenance.file,
          fact.provenance.line,
          `owner-not-in-ubg:${owner}`,
        ),
        {
          symbol: owner,
          detail:
            'the resolver walked this body, and the compiled graph has no node for it — its stops are recorded but cannot gate any route',
          owner: null,
        },
        {
          file: fact.provenance.file,
          line: fact.provenance.line,
          symbol: owner,
          contract: 'node/resolve',
          uncertainty: 'owner-not-in-ubg',
        },
      ),
    );

  return { attached, orphans, orphanOwners: orphanOwners.size };
}
