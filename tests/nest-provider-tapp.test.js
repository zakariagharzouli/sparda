// Nest Static Provider TAPP V1 — ADR-104.
//
//   @Post() create(@Body() dto)  →  this.orders.create(dto)
//                                →  create(dto)  →  this.repo.save(dto)
//
// ADR-102 proved that CHAIN from literals and could not say WHICH REQUEST VALUE
// travels it. MEASURED on `vndevteam/nestjs-boilerplate` at `cb6bea3` before any
// code here: 5 ProviderLinkage facts, 5 DbEffectOccurrences, and every one of
// them `dataOrigins: []`. The DB effect was seen; the provenance stopped at the
// class boundary.
//
// This slice states that provenance or refuses out loud, and it is EVIDENCE ONLY:
// the fixture's verdict, findings, entrypoints, effects, guards, logic nodes and
// edges are BYTE-IDENTICAL with the pass wired and unwired. The only thing that
// moves is `DataFlowPath`.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import { affectedProperties } from '../src/ubg/kernel/attach.js';
import { UNCERTAINTY_REASONS } from '../src/ubg/kernel/facts.js';
import { moduleBindingCounts } from '../src/ubg/nest-provider.js';
import {
  HTTP_SURFACES,
  ROLE_BY_OP,
  TAPP_REFUSALS,
  providerFlows,
  rebound,
  surfaceOfParameter,
  writtenDirectlyIn,
} from '../src/ubg/nest-provider-tapp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'fixtures', 'nest-provider-tapp');
const { graph, report } = compileUBG(dir, { write: false });
const g = canonicalizeGraph(graph);
const facts = report.kernel?.facts ?? [];
const tapp = facts.filter((f) => f.provenance?.contract === 'nest/provider-tapp');
const resolved = tapp.filter((f) => f.state === 'resolved');
const declared = tapp.filter((f) => f.state === 'unknown');
const at = (route) => tapp.filter((f) => f.entrypoint === `entrypoint:${route}`);
const linkages = facts.filter((f) => f.kind === 'ProviderLinkage');
const refusalAt = (route) => at(route).map((f) => f.refusal);
const line = (f) => `${f.entrypoint} [${f.role}] ${f.path.join(' → ')}`;

describe('the positive — provenance crosses the class boundary, step by step', () => {
  it('states every resolved path exactly, and no other', () => {
    // The WHOLE path, not its endpoints. A hop can vanish from the middle while
    // both ends stay identical, and a test that pinned only the ends read clean
    // over a fact that had quietly stopped saying where the value had been.
    expect(resolved.map(line).sort()).toEqual([
      'entrypoint:DELETE /orders/:id [filter] req.params.id → ParseUUIDPipe() → id → OrdersService.remove(#0) → id → Order.softDelete(#0) → filter',
      'entrypoint:PATCH /catalog/:id [data] req.body → dto → CatalogService.edit(#1) → dto → Item.update(#0) → data',
      'entrypoint:PATCH /catalog/:id [filter] req.params.id → id → CatalogService.edit(#0) → id → Item.update(#1) → filter.where.id',
      'entrypoint:PATCH /orders/:id [data] req.body → dto → OrdersService.edit(#1) → dto → Order.update(#1) → data',
      'entrypoint:PATCH /orders/:id [filter] req.params.id → id → OrdersService.edit(#0) → id → Order.update(#0) → filter',
      'entrypoint:POST /orders [data] req.body → dto → OrdersService.create(#0) → dto → Order.save(#0) → data',
      'entrypoint:POST /orders/profile [data] req.body → dto → OrdersService.store(#0) → dto → dto.city → Order.save(#0) → data.profile.city',
      'entrypoint:POST /orders/profile [data] req.body → dto → OrdersService.store(#0) → dto → dto.email → Order.save(#0) → data.email',
    ]);
  });

  it('a PIPE is a step in the journey, not a launderer of it', () => {
    // TAPP-1 decided a local normalizer does not remove provenance
    // (`parseInt(id)`); `@Param('id', ParseUUIDPipe)` is that rule at the
    // decorator position. Hiding the pipe would describe a value that arrived
    // untouched, and dropping the path would lose the whole journey over a
    // converter.
    const p = at('DELETE /orders/:id')[0].path;
    expect(p).toContain('ParseUUIDPipe()');
    expect(p[0]).toBe('req.params.id');
  });

  it('one source landing in two payload keys produces TWO paths, not a winner', () => {
    // `save({ email: dto.email, profile: { city: dto.city } })`. The first
    // implementation returned the first hit and stated `data.email` alone — the
    // second journey existed and nothing recorded it (ADR-100's rule, which this
    // pass had to be corrected to obey).
    const dests = at('POST /orders/profile')
      .map((f) => f.destination)
      .sort();
    expect(dests).toEqual(['data.email', 'data.profile.city']);
  });

  it('the two ORMs disagree about positions, and the table agrees with each', () => {
    // `OrdersController.edit` and `CatalogController.edit` are written with the
    // SAME parameter order. TypeORM `update(criteria, partialEntity)` puts the
    // selector first; Sequelize `update(values, options)` puts the payload first.
    // ONE shared role table would state the exact opposite of the truth on one of
    // them, so the roles are keyed per ORM and this is what pins it.
    const roleOf = (route, origin) =>
      at(route).find((f) => f.source.origin === origin)?.role;
    expect(roleOf('PATCH /orders/:id', 'params')).toBe('filter'); // typeorm  #0
    expect(roleOf('PATCH /orders/:id', 'body')).toBe('data'); //     typeorm  #1
    expect(roleOf('PATCH /catalog/:id', 'body')).toBe('data'); //    sequelize #0
    expect(roleOf('PATCH /catalog/:id', 'params')).toBe('filter'); // sequelize #1
  });

  it('the destination is where the value LANDED, keys and all', () => {
    const seq = at('PATCH /catalog/:id').find((f) => f.source.origin === 'params');
    expect(seq.destination).toBe('filter.where.id');
    expect(seq.path.at(-1)).toBe('filter.where.id');
  });
});

describe('the negatives — each one is the DECIDING check on its own route', () => {
  it('1 — a second literal @Module makes the binding a container decision', () => {
    // `alpha.module.ts` and `beta.module.ts` both declare TagsController and
    // TagsService. Both are perfectly readable; that is precisely why neither
    // settles which one is live.
    expect(refusalAt('POST /tags')).toEqual([TAPP_REFUSALS.AMBIGUOUS_MODULE]);
    expect(at('POST /tags').every((f) => f.state === 'unknown')).toBe(true);
  });

  it('2 — a call inside a callback is a different moment, on either side', () => {
    // ADR-102 links both of these, and it is right to: an effect reached through
    // a continuation is still an effect. A PATH is the opposite kind of claim.
    expect(refusalAt('POST /deferred/queue')).toEqual([TAPP_REFUSALS.INDIRECT_CALL]);
    expect(refusalAt('POST /deferred/later')).toEqual([TAPP_REFUSALS.INDIRECT_CALL]);
  });

  it('3 — four shapes make positions unreadable, and each refuses the whole call', () => {
    for (const route of [
      'POST /positions/spread', //       spread argument at the controller
      'POST /positions/rest', //         rest parameter on the provider
      'POST /positions/destructured', // a parameter that is not a plain name
      'POST /positions/ormspread', //    spread argument at the ORM call
    ])
      expect(refusalAt(route), route).toEqual([TAPP_REFUSALS.AMBIGUOUS_POSITIONS]);
  });

  it('4 — a rebound parameter is not the value the client sent, on either side', () => {
    expect(refusalAt('POST /rebound/ctrl')).toEqual([TAPP_REFUSALS.REBOUND]);
    expect(refusalAt('POST /rebound/svc')).toEqual([TAPP_REFUSALS.REBOUND]);
  });

  it('5 — a value in an unreadable shape is DECLARED, at both hops', () => {
    expect(refusalAt('POST /unplaceable/array')).toEqual([
      TAPP_REFUSALS.UNREADABLE_ARGUMENT,
    ]);
    expect(refusalAt('POST /unplaceable/nested')).toEqual([
      TAPP_REFUSALS.UNREADABLE_ARGUMENT,
    ]);
  });

  it('6 — one value at two positions describes no single journey', () => {
    expect(refusalAt('POST /unplaceable/twice')).toEqual([
      TAPP_REFUSALS.DUPLICATE_POSITION,
    ]);
  });

  it('7 — arriving in the provider is not arriving in the effect', () => {
    expect(refusalAt('POST /unplaceable/other')).toEqual([TAPP_REFUSALS.NOT_PLACED]);
  });

  it('8 — a proved operation with no measured ROLE is refused, never named', () => {
    // `remove(entity)` is in the V1 operation vocabulary — the linkage exists —
    // and its argument is neither cleanly a selector nor cleanly a payload. A
    // role assigned to look complete is a wrong claim, not a partial one.
    expect(linkages.some((l) => l.op === 'remove')).toBe(true);
    expect(refusalAt('POST /unplaceable/remove')).toEqual([TAPP_REFUSALS.NO_ROLE]);
  });

  it('every negative route still HAS its ADR-102 linkage', () => {
    // Without this the negatives would prove nothing: a route with no linkage
    // produces no flow for a reason that has nothing to do with this slice.
    for (const route of [
      'POST /tags',
      'POST /deferred/queue',
      'POST /deferred/later',
      'POST /positions/spread',
      'POST /positions/rest',
      'POST /positions/destructured',
      'POST /positions/ormspread',
      'POST /rebound/ctrl',
      'POST /rebound/svc',
      'POST /unplaceable/array',
      'POST /unplaceable/nested',
      'POST /unplaceable/twice',
      'POST /unplaceable/other',
      'POST /unplaceable/remove',
      'POST /lookalike/local',
      'POST /surfaces/two',
      'GET /surfaces/pipe/:id',
      'GET /surfaces/custom',
    ])
      expect(
        linkages.some((l) => l.entrypoint === `entrypoint:${route}`),
        route,
      ).toBe(true);
  });
});

describe('a surface is proved by PROVENANCE, never by a name', () => {
  it('a project-local `Body` is not Nest`s, and states nothing', () => {
    // `lookalike/fake-common.ts` exports its own `Body`, under Nest's exact name.
    // Every literal on that route reads like the real one; only the import
    // specifier differs, and that is the whole test — the same rule ADR-102
    // applies to `InjectRepository`, one layer up.
    //
    // It lives in its OWN module for a reason a mutant found: when the local
    // lookalike and the two-decorator case shared a controller, the surface
    // lookup rejected the unknown NAME before the provenance check ever ran, and
    // the count mutant survived under a fixture that was refusing for the wrong
    // reason.
    expect(at('POST /lookalike/local')).toEqual([]);
  });

  it('two decorators on one parameter are two claims, and it picks neither', () => {
    // Here `Body` IS Nest's — provenance passes, and the COUNT is what decides.
    expect(at('POST /surfaces/two')).toEqual([]);
  });

  it('a CONFIGURED pipe instance is refused — its behaviour is a value', () => {
    expect(at('GET /surfaces/pipe/:id')).toEqual([]);
  });

  it('a custom decorator is not one of the three request surfaces', () => {
    expect(at('GET /surfaces/custom')).toEqual([]);
    expect([...HTTP_SURFACES.keys()].sort()).toEqual(['Body', 'Param', 'Query']);
  });

  it('a surface that never travels leaves NO fact — absence is not admission', () => {
    // Four routes, four linkages, zero facts. An `unknown` here would claim a
    // journey nobody took, and would bury the fourteen real refusals.
    expect(
      tapp.filter(
        (f) => f.entrypoint.includes('/surfaces') || f.entrypoint.includes('/lookalike'),
      ),
    ).toEqual([]);
  });
});

describe('diagnostic only — nothing else moves, and nothing can', () => {
  it('its boundary gates no proof obligation', () => {
    expect(affectedProperties('unknown-access-path')).toEqual([]);
    expect(affectedProperties('unresolved-provider')).toEqual([]);
  });

  it('no fact states a verdict word or a safety claim', () => {
    for (const f of tapp) {
      expect(f).not.toHaveProperty('proven');
      expect(f).not.toHaveProperty('safe');
      expect(f).not.toHaveProperty('guard');
      expect(f.basis).toBe('module-literal');
    }
  });

  it('creates no node, and the graph it reports on is the graph that existed', () => {
    // BYTE-IDENTICAL with the pass unwired, measured against a pristine checkout
    // of the mission base with this same fixture copied in: 23 entrypoints, 20
    // effects, 1 guard, 23 logic, 8 state, 88 edges, 1 UNGUARDED_MUTATION.
    const kind = (k) => g.nodes.filter((n) => n.kind === k).length;
    expect(kind('entrypoint')).toBe(23);
    expect(kind('effect')).toBe(20);
    expect(kind('guard')).toBe(1);
    expect(g.edges.length).toBe(88);
    const findings = checkGraph(g).findings;
    expect(findings.map((f) => f.rule)).toEqual(['UNGUARDED_MUTATION']);
  });

  it('names only causes from the closed list, and only the one it owns', () => {
    for (const f of declared) {
      expect(UNCERTAINTY_REASONS).toContain(f.provenance.uncertainty);
      expect(f.provenance.uncertainty).toBe('unknown-access-path');
    }
  });
});

describe('rule 13 — the admission is INSIDE the fact', () => {
  it('an unknown path states NO steps, and no role it did not establish', () => {
    for (const f of declared) {
      // `[]` would be a claim about a journey ("a path with no steps"); only
      // `null` is an admission that the journey is unreadable.
      expect(f.path).toBeNull();
      expect(f.role).toBeNull();
      expect(f.destination).toBeNull();
      expect(f.boundary).toBe('UNKNOWN_ACCESS_PATH');
      expect(f.refusal).toBeTypeOf('string');
    }
  });

  it('a resolved path states its steps and admits nothing it did not meet', () => {
    for (const f of resolved) {
      expect(f.path.length).toBeGreaterThan(3);
      expect(f.boundary).toBeNull();
      expect(f.refusal).toBeNull();
      expect(f.provenance.uncertainty).toBeNull();
    }
  });

  it('`owner` is null because the proof is from SOURCE, not from a body', () => {
    for (const f of tapp) expect(f.owner).toBeNull();
  });

  it('every refusal string is one of the closed list', () => {
    const known = new Set(Object.values(TAPP_REFUSALS));
    for (const f of declared) expect(known.has(f.refusal), f.refusal).toBe(true);
  });
});

describe('route-scoped from birth, like every other evidence fact', () => {
  it('each fact names the route it is evidence ABOUT', () => {
    for (const f of tapp) expect(f.entrypoint).toMatch(/^entrypoint:[A-Z]+ \//);
  });

  it('the id carries the route, so two routes never share one proof', () => {
    for (const f of tapp) expect(f.id).toContain(f.entrypoint);
    expect(new Set(tapp.map((f) => f.id)).size).toBe(tapp.length);
  });

  it('it can only name a route the graph already has', () => {
    const routes = new Set(
      g.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.id),
    );
    for (const f of tapp) expect(routes.has(f.entrypoint), f.entrypoint).toBe(true);
  });
});

describe('it rides the ADR-102 proof rather than repeating it', () => {
  it('the ADR-102 fixture gains paths without any change to its linkages', () => {
    // The same pass, over the fixture written for the layer below — including its
    // Sequelize module, whose `findAll`/`create` positions come from the OTHER
    // half of the role table. Four resolved paths appear and nothing else about
    // that fixture moves.
    const other = compileUBG(path.join(here, 'fixtures', 'nest-direct-provider'), {
      write: false,
    });
    const its = (other.report.kernel?.facts ?? []).filter(
      (f) => f.provenance?.contract === 'nest/provider-tapp',
    );
    expect(
      its
        .filter((f) => f.state === 'resolved')
        .map(line)
        .sort(),
    ).toEqual([
      'entrypoint:GET /cats [filter] req.query.owner → owner → CatsService.findAll(#0) → owner → Cat.findAll(#0) → filter.where.owner',
      'entrypoint:GET /users/:id [filter] req.params.id → id → UsersService.findOne(#0) → id → User.findOne(#0) → filter.where.id',
      'entrypoint:POST /cats [data] req.body.name → name → CatsService.create(#0) → name → Cat.create(#0) → data.name',
      'entrypoint:POST /users [data] req.body.name → name → UsersService.save(#0) → name → User.save(#0) → data.name',
    ]);
  });

  it('no flow exists where ADR-102 refused the chain', () => {
    // token injection, a local `InjectRepository`, a missing `forFeature`, a
    // non-relative import, an entity mismatch, an operation outside the
    // vocabulary — every one of those refuses BELOW this pass, and a flow that
    // appeared anyway would mean the pass had grown its own resolver.
    const other = compileUBG(path.join(here, 'fixtures', 'nest-direct-provider'), {
      write: false,
    });
    const kernel = other.report.kernel?.facts ?? [];
    const linked = new Set(
      kernel.filter((f) => f.kind === 'ProviderLinkage').map((f) => f.entrypoint),
    );
    for (const f of kernel.filter((x) => x.provenance?.contract === 'nest/provider-tapp'))
      expect(linked.has(f.entrypoint), f.entrypoint).toBe(true);
  });
});

describe('the pieces, checked on their own', () => {
  it('the role table keys positions per ORM and shares nothing', () => {
    expect(ROLE_BY_OP.get('typeorm').get('update')).toEqual(['filter', 'data']);
    expect(ROLE_BY_OP.get('sequelize').get('update')).toEqual(['data', 'filter']);
    // an operation absent from a table has no role there, and no default
    expect(ROLE_BY_OP.get('typeorm').get('remove')).toBeUndefined();
    expect(ROLE_BY_OP.get('typeorm').get('findAll')).toBeUndefined();
  });

  it('`moduleBindingCounts` counts by resolved FILE, not by name', () => {
    const modules = [
      path.join(dir, 'src', 'ambiguous', 'alpha.module.ts'),
      path.join(dir, 'src', 'ambiguous', 'beta.module.ts'),
      path.join(dir, 'src', 'orders', 'orders.module.ts'),
    ];
    const counts = moduleBindingCounts(modules);
    const of = (f, n) =>
      counts.get(`${path.join(dir, 'src', ...f.split('/'))}#${n}`) ?? 0;
    expect(of('ambiguous/tags.controller.ts', 'TagsController')).toBe(2);
    expect(of('ambiguous/tags.service.ts', 'TagsService')).toBe(2);
    expect(of('orders/orders.controller.ts', 'OrdersController')).toBe(1);
  });

  it('`providerFlows` states nothing when nothing is proved', () => {
    // A defensive shape rather than a fixture: a controller method with no
    // parameters has no request surface, so there is no journey to describe and
    // no admission to make.
    expect(
      providerFlows({
        controllerMethod: { params: [] },
        controllerModule: null,
        serviceCall: null,
        serviceMethod: null,
        serviceName: 'S',
        serviceMember: 'm',
        ormCall: null,
        orm: 'typeorm',
        op: 'save',
        entity: 'E',
      }),
    ).toEqual([]);
  });

  it('`surfaceOfParameter` refuses a parameter with no decorator at all', () => {
    expect(surfaceOfParameter({ type: 'Identifier', name: 'x' }, null)).toBeNull();
    expect(surfaceOfParameter(null, null)).toBeNull();
  });

  it('`writtenDirectlyIn` and `rebound` answer no on an empty body', () => {
    expect(writtenDirectlyIn(null, {})).toBe(false);
    expect(rebound(null, 'x')).toBe(false);
  });
});
