// TAPP-1 — the local access path between a request surface and a DB role.
//
// TAPP-0 answers WHICH surface reached a role. "Something from the body ended up
// in this payload" is not a statement anybody can act on; `req.body.email →
// email → data.email` is. This slice records the steps in between, inside ONE
// resolved body, and refuses everything else out loud.
//
// The two properties that make it safe rather than merely useful:
//
//   1. It is not a widening of TAPP-0. `originsForRole` is the INPUT, so origin
//      coverage is byte-identical before and after — measured on all seven
//      corpus giants, occurrence and origin counts unmoved.
//   2. Every origin TAPP-0 reported gets an entry. One this walk cannot place is
//      DECLARED `UNKNOWN_ACCESS_PATH`, never dropped — an absence and an
//      unreadable path read identically downstream, which is the confusion hard
//      rule 9 exists to forbid.
//
// It is evidence, never a property: it credits no guard, removes no effect and
// moves no verdict (ADR-100).
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { UNKNOWN_ACCESS_PATH } from '../src/ubg/kernel/facts.js';
import { affectedProperties } from '../src/ubg/kernel/attach.js';
import { accessPathsForRole } from '../src/ubg/extract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph, report } = compileUBG(path.join(here, 'fixtures', 'tapp-access-paths'), {
  write: false,
});
const g = canonicalizeGraph(graph);
const facts = report.kernel?.facts ?? [];
const paths = facts.filter((f) => f.kind === 'DataFlowPath');
const occurrences = facts.filter((f) => f.kind === 'DbEffectOccurrence');

const at = (route, role) =>
  paths.filter((f) => f.entrypoint === `entrypoint:${route}` && f.role === role);
const resolvedAt = (route, role) => at(route, role).filter((f) => f.state === 'resolved');
const steps = (route, role) => resolvedAt(route, role).map((f) => f.path.join(' → '));

describe('1 — body → a local binding → a static object key', () => {
  it('states every step, not just the endpoints', () => {
    expect(steps('POST /local', 'data')).toEqual(['req.body.email → email → data.email']);
  });

  it('names its route, its owning body and the canonical effect it reached', () => {
    const [fact] = resolvedAt('POST /local', 'data');
    expect(fact.entrypoint).toBe('entrypoint:POST /local');
    expect(fact.owner).toMatch(/^logic:/);
    expect(fact.effect).toMatch(/^effect:db_write:/);
    expect(fact.source).toEqual({ origin: 'body', name: 'email' });
    expect(fact.destination).toBe('data.email');
  });
});

describe('2 — params → a local normalizer → a filter', () => {
  it('keeps the transform VISIBLE in the path', () => {
    // `parseInt` does not launder provenance. A path that jumped from
    // `req.params.id` straight to `filter.id` would describe a value that
    // arrived untouched, which is a different program.
    expect(steps('GET /normalized/:id', 'filter')).toEqual([
      'req.params.id → id → parseInt() → parsedId → filter.id',
    ]);
  });
});

describe('3 — static destructuring, aliases and nested static keys', () => {
  it('`const { email } = req.body` is one resolved path', () => {
    expect(steps('POST /destructured', 'data')).toEqual([
      'req.body.email → email → data.email',
    ]);
  });

  it('an alias chain and a nested key both survive intact', () => {
    expect(steps('POST /nested', 'data')).toEqual([
      'req.body.email → raw → alias → data.profile.email',
    ]);
  });

  it('one source landing at TWO destinations keeps BOTH', () => {
    // the destination is part of the fact identity for this reason: a key that
    // stopped at the source would keep whichever the walk reached first and
    // delete the other — a path the app takes and the evidence denies
    expect(steps('POST /twice', 'data')).toEqual([
      'req.body.email → email → data.backup',
      'req.body.email → email → data.primary',
    ]);
  });
});

describe('4 & 8 — two routes, one handler, one DB node: never one proof', () => {
  const a = resolvedAt('GET /shared/a/:id', 'filter');
  const b = resolvedAt('GET /shared/b/:id', 'filter');

  it('each route carries its OWN fact', () => {
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('the DB node is shared and the evidence is not', () => {
    // This is the whole reason the fact is route-scoped. The two paths are
    // deliberately IDENTICAL in content: if the route were not in the identity
    // they would MERGE into one, and that merge is the provenance bleed —
    // a proof established on route A licensing route B.
    expect(a[0].effect).toBe(b[0].effect);
    expect(a[0].owner).toBe(b[0].owner);
    expect(a[0].entrypoint).toBe('entrypoint:GET /shared/a/:id');
    expect(b[0].entrypoint).toBe('entrypoint:GET /shared/b/:id');
  });
});

describe('5 — everything outside the grammar is DECLARED, never guessed', () => {
  const declared = (route) =>
    at(route, 'data').filter((f) => f.state === 'unknown' && f.path === null);

  for (const [shape, route] of [
    ['a computed member `req.body[key]`', 'POST /computed'],
    ['a computed destination key', 'POST /computed-key'],
    ['a whole-surface pass `insertOne(req.body)`', 'POST /whole'],
    ['a spread', 'POST /spread'],
    ['an array', 'POST /array'],
  ])
    it(`${shape} — boundary, no path`, () => {
      expect(declared(route).length, route).toBeGreaterThan(0);
      for (const f of declared(route)) {
        expect(f.boundary).toBe(UNKNOWN_ACCESS_PATH);
        expect(f.provenance.uncertainty).toBe('unknown-access-path');
        // `null`, never `[]`: an empty list of steps is a claim about a journey,
        // not an admission that the journey is unreadable (rule 13).
        expect(f.path).toBeNull();
        expect(f.destination).toBeNull();
      }
    });

  it('no rejected shape invents a destination', () => {
    for (const route of [
      'POST /computed',
      'POST /computed-key',
      'POST /whole',
      'POST /spread',
      'POST /array',
    ])
      expect(resolvedAt(route, 'data'), route).toEqual([]);
  });
});

describe('6 — an independent value is never linked to the request', () => {
  it('a constant payload produces no path at all', () => {
    expect(at('POST /independent', 'data')).toEqual([]);
  });

  it('and its role was genuinely INSPECTED — `[]`, not `null`', () => {
    // the difference between "we looked and nothing request-derived is here" and
    // "we never looked" is the whole of rule 13 one layer down
    const occ = occurrences.filter(
      (o) => o.entrypoint === 'entrypoint:POST /independent',
    );
    expect(occ).toHaveLength(1);
    expect(occ[0].dataOrigins).toEqual([]);
  });
});

describe('7 — an effect whose source is outside V1 keeps its effect', () => {
  it('the DB write survives intact', () => {
    const occ = occurrences.filter(
      (o) => o.entrypoint === 'entrypoint:POST /session-source',
    );
    expect(occ).toHaveLength(1);
    expect(occ[0].access).toBe('write');
    expect(occ[0].table).toBe('items');
  });

  it('only the PATH is unknown — a session source is not a V1 source', () => {
    const declared = at('POST /session-source', 'filter');
    expect(declared.length).toBeGreaterThan(0);
    for (const f of declared) expect(f.state).toBe('unknown');
    expect(resolvedAt('POST /session-source', 'filter')).toEqual([]);
  });
});

describe('the reconciliation: no origin is ever dropped', () => {
  it('every origin TAPP-0 reported has an entry, resolved or declared', () => {
    // Silence on an unsupported shape is safe ONLY because of this. Without it
    // an unreadable path and a value that never flowed become the same answer.
    for (const o of occurrences)
      for (const [role, key] of [
        ['filter', 'filterOrigins'],
        ['data', 'dataOrigins'],
      ]) {
        const origins = o[key];
        if (!Array.isArray(origins) || origins.length === 0) continue;
        const covered = new Set(
          paths
            .filter((f) => f.entrypoint === o.entrypoint && f.role === role)
            .map((f) => `${f.source.origin}.${f.source.name ?? '*'}`),
        );
        for (const origin of origins) {
          const key2 = `${origin.origin}.${origin.name ?? '*'}`;
          // the one deliberate exception, and it loses nothing: `originsIn`
          // reports `req.body` alongside `req.body.email` because it walks into
          // the member's own object. That prefix is already stated by the
          // resolved path beside it.
          const prefixOfResolved =
            origin.name == null &&
            [...covered].some((c) => c.startsWith(`${origin.origin}.`) && c !== key2);
          expect(covered.has(key2) || prefixOfResolved, `${o.entrypoint} ${key2}`).toBe(
            true,
          );
        }
      }
  });
});

describe('the three states, kept in lockstep with TAPP-0', () => {
  it('null where the role was never measurable, [] where it was inspected', () => {
    const ctx = { reqDerived: null };
    // no request-binding map: nothing was measured, so nothing is reported
    expect(
      accessPathsForRole({ type: 'ObjectExpression', properties: [] }, 'data', ctx),
    ).toBeNull();
    // the role does not exist on this call
    expect(accessPathsForRole(null, 'filter', ctx)).toBeNull();
  });

  it('an inspected role with nothing request-derived is [] — an answer', () => {
    const ctx = { reqDerived: { origins: new Map(), steps: new Map() } };
    expect(
      accessPathsForRole({ type: 'ObjectExpression', properties: [] }, 'data', ctx),
    ).toEqual([]);
  });
});

describe('TAPP-1 is evidence — it moves nothing', () => {
  it('its boundary gates no proof obligation', () => {
    // `unknown-access-path` is deliberately absent from BOUNDARY_AFFECTS: this
    // slice records what it could not read, it does not degrade a verdict with
    // it. A cause that gates everything is indistinguishable from no analysis.
    expect(affectedProperties('unknown-access-path')).toEqual([]);
  });

  it('it attaches no blind spot to any node', () => {
    for (const node of g.nodes)
      for (const b of node.meta?.unknownBoundaries ?? [])
        expect(b.reason).not.toBe('unknown-access-path');
  });

  it('it credits no guard and creates no effect of its own', () => {
    expect(g.nodes.filter((n) => n.kind === 'guard')).toEqual([]);
    // every effect belongs to a DB call in the fixture, none to a path fact
    for (const f of paths) expect(f.effect).toMatch(/^effect:db_(read|write):/);
  });
});
