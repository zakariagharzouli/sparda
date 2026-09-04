// One DB operation, two routes, two proofs that must never mix.
//
// The UBG effect node is a canonical OPERATION: two routes reaching the same DAO
// line legitimately share it, and re-keying it would merge or split effects
// across every downstream count and baseline (E-100). The danger is that the
// shared node also carried the FIRST body's proof, so whichever route compiled
// first decided what the other one "proved".
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph, report } = compileUBG(
  path.join(here, 'fixtures', 'kernel-owner-asserted'),
  { write: false },
);
const occurrences = report.kernel.facts.filter((f) => f.kind === 'DbEffectOccurrence');
const forRoute = (id) => occurrences.filter((o) => o.entrypoint === id);
const CLIENT = 'entrypoint:GET /docs/user/:userId';
const SHARED = 'entrypoint:GET /docs/shared/:userId';
const SESSION = 'entrypoint:GET /docs/mine';

describe('an effect occurrence belongs to one route', () => {
  it('both routes reach the SAME canonical operation', () => {
    // If this ever stops being true the test below proves nothing: the whole
    // point is that the sharing is real and the proofs are still separate.
    const effects = [...new Set(occurrences.map((o) => o.effect))];
    expect(effects).toHaveLength(1);
    expect(forRoute(CLIENT)).toHaveLength(1);
    expect(forRoute(SESSION)).toHaveLength(1);
    // SHARED reuses the SAME handler body as CLIENT, so owner and effect are
    // both identical: only the route key separates these two occurrences.
    expect(forRoute(SHARED)).toHaveLength(1);
    expect(forRoute(SHARED)[0].owner).toBe(forRoute(CLIENT)[0].owner);
    expect(forRoute(SHARED)[0].effect).toBe(forRoute(CLIENT)[0].effect);
    expect(occurrences).toHaveLength(3);
  });

  it('carries the route, the owner body and the effect it instantiates', () => {
    for (const occurrence of occurrences) {
      expect(occurrence.entrypoint).toMatch(/^entrypoint:/);
      expect(occurrence.owner).toMatch(/^logic:/);
      expect(occurrence.effect).toMatch(/^effect:/);
      expect(occurrence.provenance.file).toBe('src/data/docs-dao.js');
      expect(occurrence.provenance.line).toBeGreaterThan(0);
    }
  });

  it('does not let route A’s session identity license route B', () => {
    // Route A passes a session identity; route B passes a client-supplied id
    // into the SAME DAO method at the SAME line.
    expect(forRoute(SESSION)[0].filterOrigins).toEqual([
      { origin: 'session', name: 'userId' },
    ]);
    expect(forRoute(CLIENT)[0].filterOrigins).toEqual([
      { origin: 'params', name: 'userId' },
    ]);
    expect(forRoute(SESSION)[0].ownerScoped).toBe(true);
    expect(forRoute(CLIENT)[0].ownerScoped).toBe(false);
  });

  it('makes the SHARED node conservative rather than first-come', () => {
    // The node keeps the MEET of the safety flags and the UNION of the origins:
    // no route can read a scope off it that its own path did not establish.
    const effect = [...graph.nodes.values()].find((n) => n.kind === 'effect');
    expect(effect.meta.ownerScoped).toBeUndefined();
    expect(effect.meta.filterOrigins.map((o) => o.origin).sort()).toEqual([
      'params',
      'session',
    ]);
  });

  it('leaves route B advisory and route A clean of that advisory', () => {
    const scope = checkGraph(canonicalizeGraph(graph)).findings.filter(
      (f) => f.rule === 'OBJECT_SCOPE_UNPROVEN',
    );
    expect(scope.map((f) => f.entrypoint)).toContain(CLIENT);
    expect(scope.map((f) => f.entrypoint)).not.toContain(SESSION);
    // and it is still advisory — this sprint does not promote it
    for (const finding of scope) expect(finding.advisory).toBe(true);
  });
});
