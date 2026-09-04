// The chain, end to end, on one application:
//
//   body UBG → UnknownBoundary → affected route → UNKNOWN/NOT_PROVEN → no PROVEN
//
// and the half that makes it a guarantee rather than a blunt instrument: a route
// with no path to the boundary is UNTOUCHED. A rule that degrades every route is
// indistinguishable from no analysis at all, so both directions are pinned here.
//
// `/affected` delegates into `@fixture/services`, a package declared in the
// workspace whose `main` points at a file that does not exist. `/independent`
// writes through a local knex handle and never mentions it. Same app, same
// compile, same verdict machinery.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { bodyKeyOfNodeId, canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';
import { routesBlockedByUnknownDependency } from '../src/commands/enforce.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph, report } = compileUBG(
  path.join(here, 'fixtures', 'workspace-boundary', 'apps', 'api'),
  { write: false },
);
const g = canonicalizeGraph(graph);
const AFFECTED = 'entrypoint:POST /affected';
const INDEPENDENT = 'entrypoint:POST /independent';

const spots = surveyBlindspots(g, report).spots;
const dependencySpots = spots.filter((s) => s.kind === 'unresolved-dependency');
const nodes = new Map(g.nodes.map((n) => [n.id, n]));
const reachFrom = (entrypoint) => {
  const seen = new Set();
  const queue = [entrypoint];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of g.edges) {
      if (e.kind !== 'control_flow' || e.from !== cur || seen.has(e.to)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return seen;
};

describe('1 — the boundary belongs to a body the graph carries', () => {
  it('/affected reaches a body stamped with an unresolved-workspace-module stop', () => {
    const carriers = [...reachFrom(AFFECTED)]
      .map((id) => nodes.get(id))
      .filter((n) => (n?.meta?.unknownBoundaries ?? []).length > 0);
    expect(carriers.length).toBeGreaterThan(0);
    const stops = carriers.flatMap((n) => n.meta.unknownBoundaries);
    const workspace = stops.filter((b) => b.reason === 'unresolved-workspace-module');
    expect(workspace.length).toBeGreaterThan(0);
    // the root cause survives the trip as a field, not as prose
    expect(workspace[0].pkg).toBe('@fixture/services');
    expect(workspace[0].affects).toContain('db-effect');
  });

  it('the owner really is a node id, not a lookalike string', () => {
    const facts = (report.kernel?.facts ?? []).filter(
      (f) => f.kind === 'UnknownBoundary' && f.symbol === 'services.chargeAccount',
    );
    expect(facts).toHaveLength(1);
    const owners = new Set(
      g.nodes
        .filter((n) => n.kind === 'logic' || n.kind === 'guard')
        .map((n) => bodyKeyOfNodeId(n.id)),
    );
    expect(owners.has(facts[0].owner)).toBe(true);
  });
});

describe('2 — the path body → boundary → route exists', () => {
  it('the affected route is named by a route-scoped blind spot', () => {
    expect(dependencySpots.map((s) => s.entrypoint)).toContain(AFFECTED);
  });

  it('reachability, not text: the spot is grouped by root cause', () => {
    const forAffected = dependencySpots.filter((s) => s.entrypoint === AFFECTED);
    // one unreadable package on one route is ONE thing to fix
    expect(forAffected).toHaveLength(1);
    expect(forAffected[0].label).toBe('@fixture/services');
  });
});

describe('3 & 4 — the dependent property cannot be PROVEN', () => {
  it('the affected route carries a HIGH blind spot on its db-effect proof', () => {
    const forAffected = dependencySpots.find((s) => s.entrypoint === AFFECTED);
    expect(forAffected.risk).toBe('high');
    expect(forAffected.affects).toEqual(['db-effect']);
  });

  it('enforce refuses to stamp PROVEN over the affected route', () => {
    // The explicit prohibition, at the command that would otherwise write a guard
    // and declare the app proven. Named rather than incidental, so removing it is
    // a visible edit.
    const blocked = routesBlockedByUnknownDependency(g, report);
    expect(blocked.map((b) => b.entrypoint)).toContain(AFFECTED);
    expect(blocked.find((b) => b.entrypoint === AFFECTED).dependency).toBe(
      '@fixture/services',
    );
  });

  it('the whole-app verdict is not PROVEN while a route rests on an unread package', () => {
    const { findings } = checkGraph(g);
    const b = surveyBlindspots(g, report);
    const state = verdictState(
      verdictOf(findings, g, {
        coverage: b.coverage.ratio,
        blindHigh: b.byRisk.critical + b.byRisk.high,
      }),
    );
    expect(state).not.toBe('PROVEN');
  });
});

describe('5 — the independent route does not regress', () => {
  it('carries no dependency blind spot of its own', () => {
    expect(dependencySpots.map((s) => s.entrypoint)).not.toContain(INDEPENDENT);
  });

  it('is not blocked by enforce', () => {
    const blocked = routesBlockedByUnknownDependency(g, report);
    expect(blocked.map((b) => b.entrypoint)).not.toContain(INDEPENDENT);
  });

  it('keeps its resolved write', () => {
    const reached = [...reachFrom(INDEPENDENT)].map((id) => nodes.get(id));
    const writes = reached.filter(
      (n) => n?.kind === 'effect' && n.meta.effectType === 'db_write',
    );
    expect(writes.map((n) => n.meta.table)).toEqual(['ledger']);
  });

  it('reaches no boundary that gates a property — which is WHY it survives', () => {
    // It does reach one: `db` is a default-export knex handle, so the walk records
    // an `unresolved-export` stop on this body. That cause has no declared proof
    // obligation, so it stays DIAGNOSTIC and degrades nothing.
    //
    // This is the discipline in one assertion. What protects `/independent` is not
    // the absence of any unknown — it is that only a cause with a declared
    // obligation may gate a verdict. Widening `BOUNDARY_AFFECTS` carelessly would
    // turn this route unknown, and this is the test that would say so.
    const stops = [...reachFrom(INDEPENDENT)]
      .map((id) => nodes.get(id))
      .flatMap((n) => n?.meta?.unknownBoundaries ?? []);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.filter((b) => b.affects.length > 0)).toEqual([]);
    expect(stops.some((b) => b.reason === 'unresolved-workspace-module')).toBe(false);
  });
});

describe('6 — an unread package is never read as "no DB effect"', () => {
  it('the affected route reaches no write, and that absence is DECLARED', () => {
    const reached = [...reachFrom(AFFECTED)].map((id) => nodes.get(id));
    const writes = reached.filter(
      (n) => n?.kind === 'effect' && n.meta.effectType === 'db_write',
    );
    // no effect resolved — which on its own is exactly what a clean route looks
    // like. The declaration is what separates the two, and it must be present.
    expect(writes).toEqual([]);
    const stops = reached.flatMap((n) => n?.meta?.unknownBoundaries ?? []);
    expect(stops.some((b) => b.reason === 'unresolved-workspace-module')).toBe(true);
  });

  it('the two populations are reported separately, never averaged', () => {
    // joined stops can gate a route; orphaned ones cannot, and folding them
    // together would let the guarantee claim coverage it does not have
    expect(report.kernel.attachment).toEqual(
      expect.objectContaining({
        attached: expect.any(Number),
        orphans: expect.any(Number),
        orphanOwners: expect.any(Number),
      }),
    );
    expect(report.kernel.attachment.attached).toBeGreaterThan(0);
  });
});
