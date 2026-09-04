// A monorepo app's mutation logic lives in workspace packages. When one of those
// packages cannot be opened, the hop into it used to leave NOTHING: the binding was
// dropped at parse time (no file to point at — correct) and the SPECIFIER went with
// it (not correct), so the deepest a downstream stop could say was "this local name
// did not bind".
//
// Worse, on every DI framework it said nothing at all: `createResolver` was given the
// kernel ledger on the Express path only, so cal.com compiled with ZERO
// UnknownBoundary facts in the entire application — 2816 real resolution stops, all
// silent. That is hard rule 9's loss shape (modelled or declared, never dropped) with
// the declaration channel unwired for six lowerings out of eight.
//
// Two properties are pinned here, and they are different:
//   1. the stop EXISTS, and names the package — the root cause a hundred dependent
//      routes share, as a field, not as prose inside a sentence;
//   2. the rest of the route survives — an unreadable package makes the DELEGATED
//      hop unknown, never the whole route. Incompleteness is localised.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { UNCERTAINTY_REASONS } from '../src/ubg/kernel/facts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph, report } = compileUBG(
  path.join(here, 'fixtures', 'workspace-boundary', 'apps', 'api'),
  { write: false },
);
const g = canonicalizeGraph(graph);
const boundaries = (report.kernel?.facts ?? []).filter(
  (f) => f.kind === 'UnknownBoundary',
);
const workspaceStops = boundaries.filter(
  (f) => f.provenance.uncertainty === 'unresolved-workspace-module',
);

describe('an unopenable workspace package is declared, never dropped', () => {
  it('is a closed, named uncertainty reason', () => {
    // free text cannot be aggregated, and a cause nobody can count is a cause
    // nobody fixes (NODE-INTELLIGENCE-GAP-MAP.md)
    expect(UNCERTAINTY_REASONS).toContain('unresolved-workspace-module');
  });

  it('every delegated hop into the unreadable package is a boundary', () => {
    // two member calls (`services.updateUser`, `services.setRoles`) and one bare
    // call imported by subpath (`auditLog`)
    expect(workspaceStops.map((f) => f.symbol).sort()).toEqual([
      'auditLog',
      'services.chargeAccount',
      'services.setRoles',
      'services.updateUser',
    ]);
  });

  it('the ROOT CAUSE is one package, carried as a field', () => {
    // Three stops, three routes, ONE cause. `pkg` is what makes a hundred of these
    // group into a single actionable line instead of a hundred opaque diagnostics.
    expect(new Set(workspaceStops.map((f) => f.pkg))).toEqual(
      new Set(['@fixture/services']),
    );
    // the specifier stays exact, so a subpath import is distinguishable from the
    // package root — same cause, different entry point
    expect(new Set(workspaceStops.map((f) => f.specifier))).toEqual(
      new Set(['@fixture/services', '@fixture/services/audit']),
    );
  });

  it('each stop names the body it happened in, so it can be tied to a route', () => {
    for (const f of workspaceStops) {
      // the canonical body key (`schema.js` `bodyKey`) — file#symbol:line, which is
      // a `logic:`/`guard:` node id minus its kind prefix
      expect(f.owner).toMatch(/^src\/server\.js#[^:]+:\d+$/);
      expect(f.provenance.file).toBe('src/server.js');
      expect(f.provenance.line).toBeGreaterThan(0);
      expect(f.provenance.contract).toBe('node/resolve');
    }
  });
});

describe('incompleteness is localised, not smeared over the route', () => {
  it('every route is still observed', () => {
    expect(
      g.nodes
        .filter((n) => n.kind === 'entrypoint')
        .map((n) => n.id)
        .sort(),
    ).toEqual([
      'entrypoint:POST /affected',
      'entrypoint:POST /audit',
      'entrypoint:POST /independent',
      'entrypoint:POST /notes',
      'entrypoint:POST /users/:id',
      'entrypoint:POST /users/:id/roles',
    ]);
  });

  it('a write that IS readable is still proven', () => {
    // `/notes` writes through a local knex handle and owes nothing to the package.
    // A boundary elsewhere in the app may not cost it its effect.
    const writes = g.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
    );
    expect(writes.map((n) => n.meta.table).sort()).toEqual(['ledger', 'notes']);
  });
});

describe('the ledger is wired to the DI lowering, not just Express', () => {
  it('a Nest app records resolution stops at all', () => {
    // The regression this guards is invisible from inside the graph: an unwired
    // ledger produces a PERFECTLY EMPTY boundary list, which reads exactly like a
    // walk that never stopped. Asserted on a Nest fixture, because Nest is where the
    // walk is deepest and where the channel was missing.
    const nest = compileUBG(path.join(here, 'fixtures', 'nest-di-blindspot-location'), {
      write: false,
    });
    const facts = (nest.report.kernel?.facts ?? []).filter(
      (f) => f.kind === 'UnknownBoundary',
    );
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts)
      expect(UNCERTAINTY_REASONS).toContain(f.provenance.uncertainty);
  });
});
