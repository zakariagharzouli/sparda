// The corpus gate could not see the result PR #47 produces.
//
// Twenty has 73 routes blocked from PROVEN by an unreadable workspace package.
// `npm run corpus` reported **0 drifted** — not because the routes were stable,
// but because `corpus.snapshot.json` pinned no dimension in which they appear.
// Removing the guarantee entirely, or silently swapping which 73 routes it covers,
// would have been invisible to the only gate that watches real applications.
//
// A COUNT IS NOT ENOUGH, and that is what these tests exist to prove: the pinned
// value is a SET of `<cause> <route>` pairs, so 73 → 73 different routes drifts.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  causeKeyOf,
  dataFlowCoverageOf,
  originCoverageOf,
  providerLinkageOf,
  routeRiskOf,
  setDelta,
} from '../scripts/route-risk.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
  fs.readFileSync(path.join(here, '..', 'corpus.snapshot.json'), 'utf8'),
);

const spot = (entrypoint, label = 'twenty-shared') => ({
  kind: 'unresolved-dependency',
  entrypoint,
  label,
  reason: 'unresolved-workspace-module',
  affects: ['db-effect'],
});
const risk = (spots, framework = 'nestjs') =>
  routeRiskOf({ framework, byRisk: { critical: 0, high: 1, medium: 0, low: 0 }, spots });

// what the oracle actually compares: `JSON.stringify` per metric key
const drifts = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

describe('a changed route drifts even when every count is identical', () => {
  it('one blocked route replaced by another at the SAME count', () => {
    const before = risk([spot('entrypoint:GET /a'), spot('entrypoint:GET /b')]);
    const after = risk([spot('entrypoint:GET /a'), spot('entrypoint:GET /c')]);
    // the counts a snapshot used to pin are byte-identical
    expect(after.blocked.length).toBe(before.blocked.length);
    expect(after.blockedByCause).toEqual(before.blockedByCause);
    // and the set is not
    expect(drifts(before, after)).toBe(true);
    expect(setDelta(before.blocked, after.blocked)).toEqual({
      removed: ['unresolved-workspace-module:twenty-shared entrypoint:GET /b'],
      added: ['unresolved-workspace-module:twenty-shared entrypoint:GET /c'],
    });
  });

  it('a route ADDED to the blocked set', () => {
    const before = risk([spot('entrypoint:GET /a')]);
    const after = risk([spot('entrypoint:GET /a'), spot('entrypoint:GET /b')]);
    expect(drifts(before, after)).toBe(true);
  });

  it('a route silently DISAPPEARING from the blocked set', () => {
    // the direction that matters most: the safety result quietly stops applying
    const before = risk([spot('entrypoint:GET /a'), spot('entrypoint:GET /b')]);
    const after = risk([spot('entrypoint:GET /a')]);
    expect(drifts(before, after)).toBe(true);
  });

  it('the ROOT CAUSE changing, with the same routes and the same count', () => {
    const before = risk([spot('entrypoint:GET /a', 'twenty-shared')]);
    const after = risk([spot('entrypoint:GET /a', 'twenty-emails')]);
    expect(after.blocked.length).toBe(before.blocked.length);
    expect(drifts(before, after)).toBe(true);
    expect(Object.keys(after.blockedByCause)).toEqual([
      'unresolved-workspace-module:twenty-emails',
    ]);
  });

  it('the REASON changing, with the same package and route', () => {
    const a = risk([spot('entrypoint:GET /a')]);
    const b = risk([{ ...spot('entrypoint:GET /a'), reason: 'unresolved-module' }]);
    expect(drifts(a, b)).toBe(true);
  });
});

describe('an unmeasured dimension is null — never an empty array or a zero', () => {
  it('a lowering with no kernel ledger reports null, not []', () => {
    // six lowerings have no ledger. `[]` would read as "we looked, nothing is
    // blocked" — a clean bill of health for code nobody instrumented (rule 13).
    const unmeasured = routeRiskOf({
      framework: 'nextjs',
      byRisk: { critical: 0, high: 0, medium: 0, low: 0 },
      spots: [],
    });
    expect(unmeasured.blocked).toBeNull();
    expect(unmeasured.blockedByCause).toBeNull();
    expect(unmeasured.blocked).not.toEqual([]);
  });

  it('a ledgered lowering with nothing blocked reports [] — a real answer', () => {
    const measured = routeRiskOf({
      framework: 'express',
      byRisk: { critical: 0, high: 0, medium: 0, low: 0 },
      spots: [],
    });
    expect(measured.blocked).toEqual([]);
    expect(measured.blockedByCause).toEqual({});
  });

  it('null and [] are DIFFERENT to the comparison the gate uses', () => {
    // the whole point: if these compared equal, turning a measurement off would
    // read as "nothing is blocked" and the gate would stay green
    const unmeasured = routeRiskOf({ framework: 'nextjs', byRisk: null, spots: [] });
    const measuredEmpty = routeRiskOf({ framework: 'express', byRisk: null, spots: [] });
    expect(drifts(unmeasured, measuredEmpty)).toBe(true);
  });

  it('a missing byRisk is null, not a fabricated set of zeroes', () => {
    expect(
      routeRiskOf({ framework: 'express', byRisk: null, spots: [] }).byRisk,
    ).toBeNull();
    expect(
      routeRiskOf({ framework: 'express', byRisk: undefined, spots: [] }).byRisk,
    ).toBeNull();
  });
});

describe('every collection is sorted before it is compared', () => {
  it('input order does not change the pinned value', () => {
    const forward = risk([
      spot('entrypoint:GET /c'),
      spot('entrypoint:GET /a'),
      spot('entrypoint:GET /b'),
    ]);
    const backward = risk([
      spot('entrypoint:GET /b'),
      spot('entrypoint:GET /a'),
      spot('entrypoint:GET /c'),
    ]);
    expect(forward).toEqual(backward);
    expect(forward.blocked).toEqual([...forward.blocked].sort());
  });

  it('cause groups are sorted too', () => {
    const r = risk([
      spot('entrypoint:GET /a', 'z-pkg'),
      spot('entrypoint:GET /b', 'a-pkg'),
    ]);
    expect(Object.keys(r.blockedByCause)).toEqual([
      'unresolved-workspace-module:a-pkg',
      'unresolved-workspace-module:z-pkg',
    ]);
  });

  it('the same route reported twice is one member, not two', () => {
    const r = risk([spot('entrypoint:GET /a'), spot('entrypoint:GET /a')]);
    expect(r.blocked).toHaveLength(1);
  });
});

describe('only a real dependency block enters the set', () => {
  it('other blind-spot kinds are not blocked routes', () => {
    // A type-only workspace import produces no boundary and therefore no spot;
    // this pins the layer below it — an unrelated spot kind can never be counted
    // as a blocked route, so the set cannot inflate by accident.
    const r = risk([
      spot('entrypoint:GET /a'),
      { kind: 'unverified-guard', entrypoint: 'entrypoint:GET /b', label: 'auth' },
      { kind: 'opaque-target', entrypoint: 'entrypoint:GET /c', label: 'x' },
      { kind: 'blind-mutation', entrypoint: 'entrypoint:GET /d', label: 'y' },
    ]);
    expect(r.blocked).toEqual([
      'unresolved-workspace-module:twenty-shared entrypoint:GET /a',
    ]);
  });

  it('a dependency spot with no entrypoint is not a blocked ROUTE', () => {
    const r = risk([spot('entrypoint:GET /a'), { ...spot(undefined) }]);
    expect(r.blocked).toHaveLength(1);
  });

  it('the cause key names both the reason and the package', () => {
    expect(causeKeyOf(spot('entrypoint:GET /a'))).toBe(
      'unresolved-workspace-module:twenty-shared',
    );
  });
});

describe('the committed baseline carries the measured result', () => {
  it('every app pins a routeRisk with a byRisk', () => {
    for (const [name, m] of Object.entries(snapshot)) {
      expect(m.routeRisk, name).toBeDefined();
      expect(m.routeRisk.byRisk, name).toEqual(
        expect.objectContaining({
          critical: expect.any(Number),
          high: expect.any(Number),
          medium: expect.any(Number),
          low: expect.any(Number),
        }),
      );
      // blocked is either a sorted array (measured) or null (no ledger) — the two
      // states this whole file exists to keep apart
      const blocked = m.routeRisk.blocked;
      expect(blocked === null || Array.isArray(blocked), name).toBe(true);
      if (Array.isArray(blocked)) expect(blocked, name).toEqual([...blocked].sort());
    }
  });

  it("twenty's 73 blocked routes are in the baseline, with their real cause", () => {
    // The number this PR produced, pinned where a gate can see it. If the
    // propagation is removed, or starts covering different routes, `npm run
    // corpus` now fails instead of printing 0 drifted.
    const twenty = snapshot.twenty;
    expect(twenty.routeRisk.blockedByCause).toEqual({
      'unresolved-workspace-module:twenty-shared': 73,
    });
    expect(twenty.routeRisk.blocked).toHaveLength(73);
    for (const entry of twenty.routeRisk.blocked)
      expect(entry).toMatch(
        /^unresolved-workspace-module:twenty-shared entrypoint:[A-Z]+ \//,
      );
  });

  it('a lowering with no ledger pins null, and is not mistaken for clean', () => {
    // dub is Next.js: no resolver ledger, so the question was never asked
    expect(snapshot.dub.routeRisk.blocked).toBeNull();
    expect(snapshot.dub.routeRisk.blockedByCause).toBeNull();
  });
});

describe('TAPP-0 origin coverage is pinned, and drift-sensitive', () => {
  const occ = (entrypoint, filterOrigins, dataOrigins) => ({
    entrypoint,
    filterOrigins,
    dataOrigins,
  });

  it('counts the three states apart — linked, empty and unmeasured', () => {
    const c = originCoverageOf([
      occ('entrypoint:POST /a', null, [{ origin: 'body', name: 'email' }]),
      occ('entrypoint:POST /b', [], []),
      occ('entrypoint:POST /c', null, null),
    ]);
    expect(c.occurrences).toBe(3);
    expect(c.data).toEqual({ linked: 1, empty: 1, unmeasured: 1 });
    expect(c.filter).toEqual({ linked: 0, empty: 1, unmeasured: 2 });
  });

  it('the same COUNT over a different occurrence still drifts', () => {
    // the lesson of #47, applied to this dimension before it can bite
    const a = originCoverageOf([
      occ('entrypoint:POST /a', null, [{ origin: 'body', name: 'email' }]),
    ]);
    const b = originCoverageOf([
      occ('entrypoint:POST /z', null, [{ origin: 'body', name: 'email' }]),
    ]);
    expect(b.data).toEqual(a.data);
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false);
  });

  it('a changed SURFACE on the same route drifts', () => {
    const a = originCoverageOf([
      occ('entrypoint:POST /a', null, [{ origin: 'body', name: 'email' }]),
    ]);
    const b = originCoverageOf([
      occ('entrypoint:POST /a', null, [{ origin: 'query', name: 'email' }]),
    ]);
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false);
  });

  it('the linked set is sorted, so walk order never leaks in', () => {
    const c = originCoverageOf([
      occ('entrypoint:POST /z', null, [{ origin: 'body', name: 'b' }]),
      occ('entrypoint:POST /a', null, [{ origin: 'body', name: 'a' }]),
    ]);
    expect(c.linked).toEqual([...c.linked].sort());
  });

  it('an unavailable measurement is null, not a fabricated zero', () => {
    expect(originCoverageOf(null)).toBeNull();
    expect(originCoverageOf(undefined)).toBeNull();
  });

  it('the committed baseline carries it for every app', () => {
    for (const [name, m] of Object.entries(snapshot)) {
      expect(m.originCoverage, name).toBeDefined();
      expect(m.originCoverage.occurrences, name).toEqual(expect.any(Number));
      expect(Array.isArray(m.originCoverage.linked), name).toBe(true);
      expect(m.originCoverage.linked, name).toEqual([...m.originCoverage.linked].sort());
    }
    // nocodb is the one app with real local request→effect linkage today; the
    // DI giants need TAPP-2 (the hop is interprocedural), and pinning the zero
    // is what makes that fact visible instead of assumed.
    expect(snapshot.nocodb.originCoverage.data.linked).toBeGreaterThan(0);
  });
});

describe('TAPP-1 access paths are pinned in the same commit that produces them', () => {
  const dfp = (entrypoint, role, origin, name, state, destination) => ({
    entrypoint,
    role,
    source: { origin, name },
    state,
    destination,
  });
  const occ = (filterOrigins, dataOrigins) => ({ filterOrigins, dataOrigins });

  it('separates a stated path from a declared boundary', () => {
    const c = dataFlowCoverageOf(
      [
        dfp('entrypoint:POST /a', 'data', 'body', 'email', 'resolved', 'data.email'),
        dfp('entrypoint:POST /b', 'data', 'body', null, 'unknown', null),
      ],
      [occ(null, [{ origin: 'body', name: 'email' }]), occ(null, null)],
    );
    expect(c.facts).toBe(2);
    expect(c.resolved).toBe(1);
    expect(c.unknown).toBe(1);
    // the third state: roles no question could even be asked about
    expect(c.unmeasuredRoles).toBe(3);
  });

  it('a resolved path becoming a BOUNDARY is drift, at the same count', () => {
    // the movement that matters most and that no total can see: evidence quietly
    // stops being stated, and the number of facts does not move
    const a = dataFlowCoverageOf(
      [dfp('entrypoint:POST /a', 'data', 'body', 'email', 'resolved', 'data.email')],
      [],
    );
    const b = dataFlowCoverageOf(
      [dfp('entrypoint:POST /a', 'data', 'body', 'email', 'unknown', null)],
      [],
    );
    expect(b.facts).toBe(a.facts);
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false);
  });

  it('the same count over a different ROUTE drifts', () => {
    const a = dataFlowCoverageOf(
      [dfp('entrypoint:POST /a', 'data', 'body', 'email', 'resolved', 'data.email')],
      [],
    );
    const b = dataFlowCoverageOf(
      [dfp('entrypoint:POST /z', 'data', 'body', 'email', 'resolved', 'data.email')],
      [],
    );
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false);
  });

  it('the path set is sorted, so walk order never leaks in', () => {
    const c = dataFlowCoverageOf(
      [
        dfp('entrypoint:POST /z', 'data', 'body', 'b', 'resolved', 'data.b'),
        dfp('entrypoint:POST /a', 'data', 'body', 'a', 'resolved', 'data.a'),
      ],
      [],
    );
    expect(c.paths).toEqual([...c.paths].sort());
  });

  it('an unavailable measurement is null, not a fabricated zero', () => {
    expect(dataFlowCoverageOf(null, [])).toBeNull();
    expect(dataFlowCoverageOf([], null)).toBeNull();
  });

  it('the committed baseline carries it for every app', () => {
    for (const [name, m] of Object.entries(snapshot)) {
      expect(m.dataFlowPaths, name).toBeDefined();
      expect(Array.isArray(m.dataFlowPaths.paths), name).toBe(true);
      expect(m.dataFlowPaths.paths, name).toEqual([...m.dataFlowPaths.paths].sort());
      // an app with no path question asked is not an app with no unknowns —
      // pinning the third state is what keeps `resolved: 0` readable
      expect(m.dataFlowPaths.unmeasuredRoles, name).toBeGreaterThan(0);
    }
    // The honest measured result on the giants: nine origins reach a DB role and
    // NONE of their paths is statable, because every one of them crosses a DI
    // boundary or is a whole-surface pass. Pinning the zero is what makes the
    // capability's real reach visible instead of asserted.
    expect(snapshot.nocodb.dataFlowPaths.unknown).toBe(9);
    expect(snapshot.nocodb.dataFlowPaths.resolved).toBe(0);
  });

  it('NodeGoat is pinned because it is the ONLY app where the seam is visible', () => {
    // Six giants produce zero resolved paths. Without this entry the corpus would
    // print "0 drifted" the day the interprocedural seam stopped resolving — the
    // #47 failure one capability later, and the reason a count is never enough.
    expect(snapshot.nodegoat, 'nodegoat must stay in the corpus').toBeDefined();
    expect(snapshot.nodegoat.dataFlowPaths.resolved).toBe(7);
    const resolved = snapshot.nodegoat.dataFlowPaths.paths.filter(
      (p) => !p.includes('UNKNOWN_ACCESS_PATH'),
    );
    // The target trajectory, pinned WHOLE — the interprocedural hop included.
    // Pinning only `source → destination` was not enough, and that was measured:
    // the hop can vanish from the middle while both endpoints stay identical, and
    // the snapshot read clean over a path that had stopped saying where the value
    // had been.
    expect(resolved).toContain(
      'entrypoint:POST /benefits filter req.body.userId → userId → BenefitsDAO.updateBenefits(#0) → userId → parseInt() → filter._id',
    );
    expect(resolved).toContain(
      'entrypoint:POST /benefits data req.body.benefitStartDate → benefitStartDate → BenefitsDAO.updateBenefits(#1) → startDate → data.$set.benefitStartDate',
    );
    expect(resolved).toContain(
      'entrypoint:GET /allocations/:userId filter req.params.userId → userId → AllocationsDAO.getByUserIdAndThreshold(#0) → userId → parseInt() → parsedUserId → searchCriteria().return@81 → filter.userId',
    );
    expect(resolved).toContain(
      'entrypoint:GET /allocations/:userId filter req.params.userId → userId → AllocationsDAO.getByUserIdAndThreshold(#0) → userId → parseInt() → parsedUserId → searchCriteria().return@77 → template-interpolation → filter.$where',
    );
    expect(resolved).toContain(
      'entrypoint:GET /allocations/:userId filter req.query.threshold → threshold → AllocationsDAO.getByUserIdAndThreshold(#1) → threshold → searchCriteria().return@77 → template-interpolation → filter.$where',
    );
  });
});

describe('Nest provider linkage is pinned — the zero AND the refusals', () => {
  it('counts what was linked and what was declined, apart', () => {
    const r = providerLinkageOf({
      framework: 'nestjs',
      linkages: [
        {
          entrypoint: 'entrypoint:GET /a',
          orm: 'typeorm',
          provider: 'S.f',
          op: 'findOne',
          entity: 'E',
          effect: 'effect:db_read:x',
        },
      ],
      boundaries: [{ provenance: { uncertainty: 'unresolved-provider' } }],
    });
    expect(r.linked).toEqual(['entrypoint:GET /a typeorm S.f findOne(E)']);
    expect(r.withEffect).toBe(1);
    expect(r.declined).toBe(1);
    expect(r.byReason).toEqual({ 'unresolved-provider': 1 });
  });

  it('a grammar that went BLIND is drift, even at zero linkages', () => {
    // Every pinned giant links zero. So the refusals are the only signal the
    // corpus has that this pass still runs at all: 171 declared boundaries
    // becoming 0 must be visible, and no `linked: []` could show it.
    const looking = providerLinkageOf({
      framework: 'nestjs',
      linkages: [],
      boundaries: [{ provenance: { uncertainty: 'unresolved-provider' } }],
    });
    const blind = providerLinkageOf({
      framework: 'nestjs',
      linkages: [],
      boundaries: [],
    });
    expect(looking.linked).toEqual(blind.linked);
    expect(JSON.stringify(looking) === JSON.stringify(blind)).toBe(false);
  });

  it('a lowering that never runs the pass answers null, not zero', () => {
    const r = providerLinkageOf({ framework: 'express', linkages: [], boundaries: [] });
    expect(r.linked).toBeNull();
    expect(r.declined).toBeNull();
  });

  it('the committed baseline carries it for every app', () => {
    for (const [name, m] of Object.entries(snapshot)) {
      expect(m.providerLinkage, name).toBeDefined();
      if (m.providerLinkage.linked === null) continue;
      expect(m.providerLinkage.linked, name).toEqual(
        [...m.providerLinkage.linked].sort(),
      );
    }
    // The honest measured result: every pinned giant links ZERO, because their
    // modules use factory providers, path aliases or no TypeORM/Sequelize
    // forFeature at all. Pinning the zero is what makes a future invention visible.
    expect(snapshot.twenty.providerLinkage.linked).toEqual([]);
    expect(snapshot.twenty.providerLinkage.declined).toBeGreaterThan(0);
    expect(snapshot.nodegoat.providerLinkage.linked).toBeNull();
  });
});
