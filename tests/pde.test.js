import { describe, expect, it } from 'vitest';
import {
  PDE_TERNARY_KERNEL,
  PDE_STATUS,
  decodePdeStatusCache,
  encodePdeStatusCache,
  explainPdeClaim,
  pdeClaimsForSparda,
  pdeSummaryForSparda,
  solvePde,
  updatePde,
} from '../src/ubg/pde.js';

const unreadGuard = [
  {
    id: 'premise',
    certificate: { status: PDE_STATUS.PROVEN, reason: 'oracle agrees' },
  },
  {
    id: 'guard',
    certificate: {
      status: PDE_STATUS.UNKNOWN,
      reason: 'decorator definition unreadable',
    },
  },
  {
    id: 'effect',
    certificate: { status: PDE_STATUS.PROVEN, reason: 'AST fact' },
  },
  {
    id: 'route',
    certificate: { status: PDE_STATUS.PROVEN, reason: 'route checker' },
    requires: ['premise', 'guard', 'effect'],
  },
  {
    id: 'verdict',
    certificate: { status: PDE_STATUS.PROVEN, reason: 'verdict checker' },
    requires: ['route'],
  },
];

const printable = (result) =>
  Object.fromEntries(
    [...result.states.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, value]) => [id, value]),
  );

const unreadUbgGuard = {
  nodes: [
    { id: 'entrypoint:DELETE /orders', kind: 'entrypoint', meta: {} },
    { id: 'guard:auth', kind: 'guard', meta: { verified: false } },
    {
      id: 'effect:db_write:orders',
      kind: 'effect',
      meta: { effectType: 'db_write' },
    },
  ],
  edges: [
    {
      kind: 'control_flow',
      from: 'entrypoint:DELETE /orders',
      to: 'guard:auth',
    },
    {
      kind: 'control_flow',
      from: 'guard:auth',
      to: 'effect:db_write:orders',
    },
  ],
};

describe('Proof Diffusion Engine', () => {
  it('propagates uncertainty with a lazy shared provenance trace', () => {
    const result = solvePde(unreadGuard);
    expect(result.states.get('verdict').status).toBe(PDE_STATUS.UNKNOWN);
    expect(explainPdeClaim(result, 'verdict').reasons).toEqual([
      {
        origin: 'guard',
        reason: 'decorator definition unreadable',
        path: ['guard', 'route', 'verdict'],
      },
    ]);
  });

  it('keeps an SCC of local certificates unknown and names its cycle', () => {
    const result = solvePde([
      { id: 'a', certificate: { status: PDE_STATUS.PROVEN }, requires: ['b'] },
      { id: 'b', certificate: { status: PDE_STATUS.PROVEN }, requires: ['a'] },
    ]);
    expect(result.states.get('a').status).toBe(PDE_STATUS.UNKNOWN);
    expect(explainPdeClaim(result, 'a').reasons[0].reason).toBe(
      'circular certificates have no independent proof root',
    );
  });

  it('round-trips the ternary status cache and provenance DAG without loss', () => {
    const original = solvePde(unreadGuard);
    const snapshot = encodePdeStatusCache(original);
    const restored = decodePdeStatusCache(snapshot);
    expect(snapshot.bytes.length).toBe(1); // five claims, five trits, one byte
    expect(snapshot.v).toBe(PDE_TERNARY_KERNEL.cacheVersion);
    expect(original.states.get('verdict').trit).toBe(1);
    expect(printable(restored)).toEqual(printable(original));
    expect(restored.provenance.serialize()).toEqual(original.provenance.serialize());
  });

  it('keeps hash-consed provenance bounded on a long unknown path', () => {
    const claims = Array.from({ length: 128 }, (_, index) => ({
      id: `chain:${String(index).padStart(3, '0')}`,
      certificate: {
        status: index === 0 ? PDE_STATUS.UNKNOWN : PDE_STATUS.PROVEN,
        reason: index === 0 ? 'unmeasured source' : 'checked link',
      },
      requires: index ? [`chain:${String(index - 1).padStart(3, '0')}`] : [],
    }));
    const result = solvePde(claims);
    const trace = explainPdeClaim(result, 'chain:127').reasons[0];

    expect(result.states.get('chain:127').status).toBe(PDE_STATUS.UNKNOWN);
    expect(trace.path).toHaveLength(128);
    expect(result.provenance.serialize().every(({ id }) => id.length <= 24)).toBe(true);
  });

  it('makes the differential update equal a complete solve after a repair', () => {
    const before = solvePde(unreadGuard);
    const incremental = updatePde(before, [
      {
        id: 'guard',
        certificate: {
          status: PDE_STATUS.PROVEN,
          reason: 'deny path independently checked',
        },
      },
    ]);
    const complete = solvePde(
      unreadGuard.map((claim) =>
        claim.id === 'guard'
          ? {
              ...claim,
              certificate: {
                status: PDE_STATUS.PROVEN,
                reason: 'deny path independently checked',
              },
            }
          : claim,
      ),
    );
    expect(printable(incremental)).toEqual(printable(complete));
    expect(incremental.states.get('verdict').status).toBe(PDE_STATUS.PROVEN);
    expect(incremental.execution).toEqual({
      kernel: PDE_TERNARY_KERNEL.id,
      claims: 5,
      dependencyEdges: 4,
      dirtyClaims: 3,
      evaluations: 3,
      stateChanges: 3,
      ternaryStatusBytes: 1,
    });
  });

  it('diffuses an unread UBG guard through its real control-flow path', () => {
    const claims = pdeClaimsForSparda({
      graph: unreadUbgGuard,
      premiseBasis: 'measured',
      blindHigh: 0,
      findings: [],
    });
    const result = solvePde(claims);
    const summary = pdeSummaryForSparda({
      graph: unreadUbgGuard,
      premiseBasis: 'measured',
      blindHigh: 0,
      findings: [],
    });

    expect(result.states.get('ubg:node:guard:auth').status).toBe(PDE_STATUS.UNKNOWN);
    expect(result.states.get('ubg:entrypoint:entrypoint:DELETE /orders').status).toBe(
      PDE_STATUS.UNKNOWN,
    );
    expect(explainPdeClaim(result, 'verdict:eligibility').reasons).toContainEqual(
      expect.objectContaining({
        origin: 'ubg:node:guard:auth',
        reason: 'guard has no independently checked deny path',
        path: expect.arrayContaining([
          'ubg:node:guard:auth',
          'ubg:node:entrypoint:DELETE /orders',
          'ubg:entrypoint:entrypoint:DELETE /orders',
          'ubg:route-surface',
          'verdict:eligibility',
        ]),
      }),
    );
    expect(summary).toMatchObject({
      diagnosticOnly: true,
      authority: 'none',
      status: PDE_STATUS.UNKNOWN,
      ubg: {
        provided: true,
        nodes: 3,
        diffusionEdges: 2,
        entrypoints: 1,
        opaqueNodes: 1,
      },
    });
  });

  it('repairs a real UBG-derived claim incrementally with the same result as a full solve', () => {
    const claims = pdeClaimsForSparda({
      graph: unreadUbgGuard,
      premiseBasis: 'measured',
      blindHigh: 0,
      findings: [],
    });
    const incremental = updatePde(solvePde(claims), [
      {
        id: 'ubg:node:guard:auth',
        certificate: {
          status: PDE_STATUS.PROVEN,
          reason: 'deny path independently checked',
        },
      },
    ]);
    const complete = solvePde(
      claims.map((claim) =>
        claim.id === 'ubg:node:guard:auth'
          ? {
              ...claim,
              certificate: {
                status: PDE_STATUS.PROVEN,
                reason: 'deny path independently checked',
              },
            }
          : claim,
      ),
    );

    expect(printable(incremental)).toEqual(printable(complete));
    expect(incremental.states.get('verdict:eligibility').status).toBe(PDE_STATUS.PROVEN);
    expect(incremental.execution.dirtyClaims).toBeLessThan(incremental.execution.claims);
  });

  it('keeps the first SPARDA adapter diagnostic-only', () => {
    const summary = pdeSummaryForSparda({
      premiseBasis: 'unmeasured',
      blindHigh: 0,
      findings: [],
    });
    expect(summary.status).toBe(PDE_STATUS.UNKNOWN);
    expect(summary.cache.statusBytes).toBe(1);
  });

  it('makes semantic conservation a PDE dependency when a ledger is supplied', () => {
    const summary = pdeSummaryForSparda({
      premiseBasis: 'measured',
      blindHigh: 0,
      findings: [],
      semanticLedger: { unmeasured: [{ id: 'js:unlinked-route' }] },
    });
    expect(summary.status).toBe(PDE_STATUS.UNKNOWN);
    expect(summary.execution.kernel).toBe(PDE_TERNARY_KERNEL.id);
    expect(summary.execution.claims).toBe(5);
  });

  it('keeps a giant diagnostic summary bounded without losing its uncertainty count', () => {
    const summary = pdeSummaryForSparda({
      premiseBasis: 'measured',
      blindHigh: 0,
      findings: [],
      report: {
        unknownHandlers: Array.from({ length: 20 }, (_, index) => ({
          file: 'server.js',
          line: index + 1,
          target: `dynamic_${index}`,
        })),
      },
    });

    expect(summary.status).toBe(PDE_STATUS.UNKNOWN);
    expect(summary.reasonCount).toBeGreaterThan(summary.reasons.length);
    expect(summary.reasons).toHaveLength(16);
    expect(summary.reasonsTruncated).toBe(true);
  });
});
