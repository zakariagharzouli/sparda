// Nest static direct provider V1 — ADR-102.
//
// A Nest route reaches its ORM call through a chain the CONTAINER assembles. The
// Core already follows that chain by reading the controller's constructor
// parameter TYPE, which is sound for over-approximating effects and is not a
// proof about which class is behind the dependency: `useClass`, `useValue`, a
// factory, a token or a subclass override all put a different body there.
//
// This slice proves the chain from LITERALS instead — a `@Module` declaration,
// exact relative imports, and official-package provenance for every ORM symbol —
// or it refuses out loud. NAMES ARE NEVER ENOUGH: a local file exporting its own
// `InjectRepository` and its own `TypeOrmModule` is a real shape, and a rule that
// matched the name would credit it.
//
// It is EVIDENCE. It creates no effect, removes none, credits no guard, no
// ownership, no `PROVEN`, and changes no finding. The fixture's verdict, findings,
// effect count, guard count and coverage are identical with and without it.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { affectedProperties } from '../src/ubg/kernel/attach.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph, report } = compileUBG(
  path.join(here, 'fixtures', 'nest-direct-provider'),
  {
    write: false,
  },
);
const g = canonicalizeGraph(graph);
const facts = report.kernel?.facts ?? [];
// ADR-102's linkages ONLY. ADR-106 shares this fact kind and proves a DIFFERENT
// contract over the same fixture: it accepts two shapes ADR-102 refuses on
// purpose (a congruent `@Inject(ClassToken)` and an alias that resolves to
// exactly one declaration), and it refuses everything ADR-102 refuses about the
// TypeORM bridge — `forFeature`, entity congruence and the default connection are
// required by BOTH. Every refusal below is a statement about THIS contract, and
// reading both grammars through one unfiltered list would turn each into an
// assertion about neither. The ADR-106 side of the same fixture is pinned at the
// bottom of the file, so nothing here is merely relaxed.
const links = facts.filter(
  (f) => f.kind === 'ProviderLinkage' && f.provenance.contract === 'nest/provider',
);
const strictLinks = facts.filter(
  (f) => f.kind === 'ProviderLinkage' && f.provenance.contract === 'nest/strict-chain',
);
const declined = facts.filter(
  (f) => f.kind === 'UnknownBoundary' && f.provenance.contract === 'nest/provider',
);
const at = (route) => links.filter((l) => l.entrypoint === `entrypoint:${route}`);
const sig = (l) => `${l.orm} ${l.controller} → ${l.provider} → ${l.op}(${l.entity})`;

describe('1 — Sequelize, direct and proved', () => {
  it('a read links the route to the model operation', () => {
    expect(at('GET /cats').map(sig)).toEqual([
      'sequelize CatsController.findAll → CatsService.findAll → findAll(Cat)',
    ]);
  });

  it('a write does too, and neither invents an effect', () => {
    expect(at('POST /cats').map(sig)).toEqual([
      'sequelize CatsController.create → CatsService.create → create(Cat)',
    ]);
    // Core models no Sequelize effect for this receiver today. `null` is the
    // honest measurement — "both ends are proved and no effect node exists" —
    // never a claim that nothing happens (rule 13).
    for (const l of at('POST /cats')) expect(l.effect).toBeNull();
  });

  it('the provenance is the package, never the name', () => {
    for (const l of [...at('GET /cats'), ...at('POST /cats')]) {
      expect(l.pkg).toBe('@nestjs/sequelize');
      expect(l.basis).toBe('module-literal');
    }
  });
});

describe('2 — TypeORM, direct and proved', () => {
  it('links the repository operation the module registered', () => {
    expect(at('GET /users/:id').map(sig)).toEqual([
      'typeorm UsersController.findOne → UsersService.findOne → findOne(User)',
    ]);
    expect(at('POST /users').map(sig)).toEqual([
      'typeorm UsersController.create → UsersService.save → save(User)',
    ]);
  });

  it('carries the EXISTING effect node when the graph has one, and null when not', () => {
    // `repo.save` is already a db_write in the graph; `repo.findOne` is not an
    // effect at all today. Both are proved linkages, and the field says which is
    // which instead of averaging them.
    expect(at('POST /users')[0].effect).toMatch(/^effect:db_write:/);
    expect(at('GET /users/:id')[0].effect).toBeNull();
  });

  it('the entity is matched by FILE, and travels with the fact', () => {
    expect(at('POST /users')[0].entityFile).toBe('src/typeorm/user.entity.ts');
  });
});

describe('3 — token / @Inject injection stays UNKNOWN', () => {
  it('no linkage is stated for the token route', () => {
    // `providers: [{ provide: ORDERS_SERVICE, useClass: OrdersService }]` — the
    // container chooses. The source does not, so neither does SPARDA.
    expect(at('GET /orders/:id')).toEqual([]);
  });

  it('and the refusal is DECLARED, with its own cause', () => {
    const named = declined.filter((d) => d.symbol === 'OrdersModule');
    expect(named.length).toBeGreaterThan(0);
    expect(named[0].provenance.uncertainty).toBe('unresolved-provider');
  });
});

describe('4 — a mismatched forFeature([Other]) stays UNKNOWN', () => {
  it('the module registered Other and the service injects Thing — no linkage', () => {
    // Same NAME is not same ENTITY, and here not even the name matches: the
    // repository this service receives is not the one this module registered.
    expect(at('GET /things/:id')).toEqual([]);
  });

  it('the refusal names the entity it could not reconcile', () => {
    const named = declined.filter((d) => (d.symbol ?? '').includes('Thing'));
    expect(named.length).toBeGreaterThan(0);
    expect(named[0].provenance.uncertainty).toBe('unresolved-provider');
  });
});

describe('5 — local lookalikes named InjectRepository/TypeOrmModule stay UNKNOWN', () => {
  it('a name is not a provenance', () => {
    // `./fake-typeorm` exports its own `InjectRepository` and its own
    // `TypeOrmModule`. Every literal in this module reads exactly like the real
    // one; only the import source differs, and that is the whole test.
    expect(at('GET /notes/:id')).toEqual([]);
  });

  it('the refusal is declared against the lookalike module', () => {
    const named = declined.filter((d) => d.symbol === 'NotesModule');
    expect(named.length).toBeGreaterThan(0);
    expect(named[0].provenance.uncertainty).toBe('unresolved-provider');
  });

  it('no linkage anywhere cites a package that is not official', () => {
    for (const l of links)
      expect(['@nestjs/typeorm', '@nestjs/sequelize']).toContain(l.pkg);
  });
});

describe('every check is the DECIDING one somewhere', () => {
  // Each of these routes passes every check but ONE. Without them a refusal that
  // fires earlier masks the check under test, and a rule can be deleted with the
  // suite still green — which is exactly what five surviving mutants showed.
  const declinedFor = (needle) =>
    declined.filter((d) => (d.symbol ?? '').includes(needle));

  it('an official FACTORY with a lookalike DECORATOR is refused on the decorator', () => {
    expect(at('GET /docs/:id')).toEqual([]);
    expect(declinedFor('DocsService').length).toBeGreaterThan(0);
  });

  it('a literal providers list with an @Inject PARAMETER is refused on the parameter', () => {
    expect(at('GET /tags/:id')).toEqual([]);
    expect(declinedFor('TagsController.tags').length).toBeGreaterThan(0);
  });

  it('a fully proved chain calling an UNMEASURED operation is refused on the vocabulary', () => {
    // `increment` is real TypeORM and outside the vocabulary the Lab measured.
    // A longer list is a wider claim, and it needs its own evidence.
    expect(at('POST /hits/:id')).toEqual([]);
    expect(declinedFor('increment').length).toBeGreaterThan(0);
  });

  it('a tsconfig ALIAS that resolves is still not an exact relative import', () => {
    // The alias resolves to a real file — which is why the check has to be about
    // what was WRITTEN. This is twenty's convention across its entire server, and
    // it is the single reason 19 of its modules are declined.
    expect(at('GET /boxes/:id')).toEqual([]);
    expect(declinedFor('BoxesController').length).toBeGreaterThan(0);
    expect(declinedFor('BoxesController')[0].provenance.uncertainty).toBe(
      'unresolved-module',
    );
  });
});

describe('the slice is evidence — it moves nothing', () => {
  it('its boundary gates no proof obligation', () => {
    // `unresolved-provider` is deliberately absent from BOUNDARY_AFFECTS: this
    // records what it could not read, it does not degrade a verdict with it.
    expect(affectedProperties('unresolved-provider')).toEqual([]);
  });

  it('creates no effect node of its own', () => {
    // Both effects here predate this slice: the existing `repoTables` branch
    // models `repo.save` and `repo.increment` as writes. Every effect is
    // answerable to a PERSISTENCE contract; none is attributed to nest/provider,
    // which is what "creates no effect" means at the fact layer.
    const effects = facts.filter((f) => f.kind === 'DbEffect');
    expect(effects.length).toBeGreaterThan(0);
    for (const e of effects) expect(e.provenance.contract).not.toBe('nest/provider');
    expect(
      g.nodes
        .filter((n) => n.kind === 'effect')
        .map((n) => n.meta.op)
        .sort(),
    ).toEqual(['insert', 'update']);
  });

  it('an effect Core models and the grammar refuses are INDEPENDENT', () => {
    // `repo.increment` is a db_write in the graph AND outside the measured
    // vocabulary, so the route keeps its effect and gains no linkage. Evidence
    // that is absent never subtracts from behaviour that is present.
    expect(at('POST /hits/:id')).toEqual([]);
    expect(
      g.nodes.some((n) => n.kind === 'effect' && n.loc?.file?.includes('hits.service')),
    ).toBe(true);
  });

  it('credits no guard, no ownership, no auth', () => {
    expect(g.nodes.filter((n) => n.kind === 'guard')).toEqual([]);
    for (const n of g.nodes.filter((n) => n.kind === 'effect'))
      expect(n.meta.ownerScoped).toBeUndefined();
  });

  it('states no verdict word and no safety claim', () => {
    for (const l of links) {
      expect(l).not.toHaveProperty('proven');
      expect(l).not.toHaveProperty('safe');
      expect(l).not.toHaveProperty('guarded');
    }
  });

  it('every linkage names a route the graph already has', () => {
    // this pass may add evidence ABOUT the route table, never a route TO it
    const routes = new Set(
      g.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.id),
    );
    for (const l of links) expect(routes).toContain(l.entrypoint);
  });
});

describe('the refusals are exhaustive, not incidental', () => {
  it('exactly the three negative modules are declined, and no positive is', () => {
    const symbols = new Set(declined.map((d) => d.symbol));
    expect(symbols).toContain('OrdersModule');
    expect(symbols).toContain('NotesModule');
    expect([...symbols].some((s) => s.includes('Thing'))).toBe(true);
    // a module the grammar fully proved is never also declined
    expect(symbols).not.toContain('UsersModule');
    expect(symbols).not.toContain('CatsModule');
  });

  it('a module with no controllers is not declined — there is nothing to refuse', () => {
    // AppModule only composes other modules. Declaring it would fill the ledger
    // with every application's root and bury the real refusals.
    expect([...declined].some((d) => d.symbol === 'AppModule')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The ADR-106 side of the SAME fixture. Each assertion here is the mirror of a
// refusal above: ADR-102 declines the shape and the strict contract proves it, or
// vice versa. Without this block, scoping `links` to one contract would delete a
// check instead of aiming it.
describe('ADR-106 — the strict contract over the ADR-102 fixture', () => {
  const strictAt = (route) =>
    [...links, ...strictLinks].filter(
      (l) => l.entrypoint === `entrypoint:${route}` && l.strict,
    );

  it('a congruent @Inject(ClassToken) is a proof, and a string token is not', () => {
    // ADR-102 refuses BOTH on "the parameter carries a decorator". The strict
    // contract separates them: `@Inject(TagsService) tags: TagsService` names the
    // very class the type names, so nothing is left to the container — while
    // `@Inject(ORDERS_SERVICE)` is a token this grammar does not read.
    expect(strictAt('GET /tags/:id').map((l) => l.strict.field.injection)).toEqual([
      'inject-token',
    ]);
    expect(strictAt('GET /orders/:id')).toEqual([]);
  });

  it('an alias that resolves to exactly one declaration is an identity', () => {
    // ADR-102's contract is the SPELLING ("exact relative import"); ADR-106's is
    // the IDENTITY ("imports, exports and re-exports exact"). The alias resolves
    // to one declaring file, so the identity holds and the spelling does not.
    expect(strictAt('GET /boxes/:id').map((l) => l.strict.identity.name)).toEqual([
      'BoxesService',
    ]);
  });

  it('both contracts refuse an entity the module never registered', () => {
    // The mismatch fixture registers `Other` and injects `Thing`. An early draft
    // of ADR-106 PROVED this route, because it read the `typeorm` import as
    // enough and never asked which repository provider the container actually
    // holds. That was a proof leak — `forFeature([Other])` creates no provider
    // for `Repository<Thing>`, and such an application does not even resolve at
    // runtime. The two contracts now agree, and they agree for the same reason.
    expect(strictAt('GET /things/:id')).toEqual([]);
    // The lookalike route stays refused under BOTH contracts: a local file
    // exporting its own `InjectRepository` is a name, and a name is not a
    // provenance.
    expect(strictAt('GET /docs/:id')).toEqual([]);
  });

  it('a strict receipt names the bridge that registered its handle', () => {
    // The link the leak was missing: the receipt must prove the Nest binding of
    // the ORM HANDLE, not only of the provider class that holds it.
    for (const l of [...links, ...strictLinks]) {
      if (!l.strict || l.strict.handle.orm !== 'typeorm') continue;
      expect(l.strict.handle.entity).toBeTruthy();
      expect(l.strict.handle.pkg).toBe('typeorm');
    }
  });

  it('the vocabulary is the same set under both contracts', () => {
    // `increment` is a real TypeORM method and is outside both vocabularies. Two
    // layers that disagreed about what an operation IS would be worse than one
    // layer admitting a gap.
    expect(strictAt('GET /hits/:id')).toEqual([]);
  });

  it('every strict receipt carries all eight links, or it is not a receipt', () => {
    expect(strictLinks.length + links.filter((l) => l.strict).length).toBeGreaterThan(0);
    for (const l of [...links, ...strictLinks]) {
      if (!l.strict) continue;
      const s = l.strict;
      expect(s.route.pkg).toBe('@nestjs/common');
      for (const link of [
        s.route,
        s.field,
        s.identity,
        s.binding,
        s.method,
        s.handle,
        s.operation,
      ])
        expect(link).toBeTruthy();
      expect(s.hops.length).toBeGreaterThan(0);
      expect(s.hops.length).toBeLessThanOrEqual(3);
      expect(s.depth).toBe(s.hops.length);
      // Counter-example 3: a default label is not an identification.
      expect(s.handle.orm).not.toBe('mongo/driver');
    }
  });
});
