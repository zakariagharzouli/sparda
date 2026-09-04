import { describe, expect, it } from 'vitest';
import {
  enforceSoundness,
  loadCases,
  normalizeVerdict,
  observeCase,
  summarize,
  validateCases,
} from '../bench/soundness/run.mjs';

describe('private soundness benchmark contract', () => {
  it('uses at least twelve pinned external cases, including hard negatives', () => {
    const cases = loadCases();
    expect(() => validateCases(cases)).not.toThrow();
    expect(cases).toHaveLength(16);
    expect(cases.filter((c) => c.classification === 'vulnerable')).toHaveLength(6);
    expect(cases.filter((c) => c.hardNegative)).toHaveLength(10);
  });

  it('normalizes every non-claim to UNKNOWN instead of PROVEN', () => {
    for (const raw of ['NO_PROOF', 'SURFACE', 'PREMISE_GAP'])
      expect(normalizeVerdict(raw)).toBe('UNKNOWN');
    expect(normalizeVerdict('PARTIAL')).toBe('PARTIAL');
    expect(normalizeVerdict('NOT_PROVEN')).toBe('NOT_PROVEN');
  });

  it('fails the gate if even one vulnerable route is blanched', () => {
    const summary = summarize([
      {
        id: 'counterexample',
        classification: 'vulnerable',
        measurement: 'scored',
        route: 'POST /danger',
        routeClaim: 'CLEAN',
        routeVerdict: 'NOT_PROVEN',
        hardFindings: [],
        missCause: 'test-only',
      },
    ]);
    expect(() => enforceSoundness(summary)).toThrow(
      'SOUNDNESS FAILURE: 1 vulnerable route(s) were blanched',
    );
  });

  it('keeps a route with a declared high-risk registration uncertainty UNKNOWN', () => {
    const observation = observeCase(
      {
        id: 'callback-setup',
        classification: 'vulnerable',
        measurement: 'scored',
        route: { method: 'post', path: '/danger' },
        missCause: 'test-only',
      },
      {
        graph: {
          nodes: [
            {
              id: 'entrypoint:POST /danger',
              loc: { file: 'routes.js', line: 9 },
            },
          ],
          edges: [],
        },
        findings: [],
        blindspots: { spots: [] },
        report: { skipped: [{ risk: 'high', file: 'routes.js', line: 9 }] },
        rawVerdict: 'PROVEN',
      },
    );

    expect(observation.routeClaim).toBe('UNKNOWN');
    expect(observation.routeVerdict).toBe('UNKNOWN');
  });

  it('reports route-recognition recall as unmeasured without scored vulnerable routes', () => {
    const summary = summarize([
      {
        id: 'only-negative',
        classification: 'safe',
        measurement: 'scored',
        route: 'POST /safe',
        routeClaim: 'CLEAN',
        routeVerdict: 'PROVEN',
        observedEntrypoint: true,
        linkedRoute: true,
        hardFindings: [],
      },
    ]);

    expect(summary.coverage.routeRecall).toBeNull();
    expect(summary.coverage.linkedRouteRecall).toBeNull();
  });
});
