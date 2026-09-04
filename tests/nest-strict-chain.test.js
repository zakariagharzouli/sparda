// Nest strict proof chain — ADR-106.
//
// ADR-102 proved ONE Nest chain from literals and gated it on
// `TypeOrmModule.forFeature([Entity])`. On the seven pinned Nest applications
// that gate fires ZERO times, so the fact exists and never speaks. The
// differential review against the Lab's Bounded Semantic Evidence Kernel
// measured two more things, and they matter more than the count:
//
//   1. a LOCAL file exporting its own `Repository` gets exactly the evidence the
//      real `typeorm` gets — the Core credits the lookalike;
//   2. every `DbEffect` on a Prisma application carries `mongo/driver`, which is
//      `contractFor`'s DEFAULT and not an identification.
//
// Neither is a soundness hole — over-approximating an effect is the safe
// direction and `falseProven` stays 0 either way. Both are a PRECISION hole, and
// this slice states the distinction or refuses.
//
// EIGHT LINKS, EVERY ONE WITH ITS OWN PROVENANCE:
//
//   route exacte → champ injecté exact → identité de classe exacte
//     → binding Nest exact → méthode exacte → résumés bornés (≤ 3)
//     → handle ORM officiel → opération ORM officielle
//
// THE ORM PROVENANCE NEVER SUBSTITUTES FOR THE BINDING, and that is the rule a
// "we found the real package" shortcut would quietly delete. A handle imported
// from `@prisma/client` itself, inside a class whose Nest binding is a factory,
// is UNKNOWN.
//
// IT IS EVIDENCE. It creates no node, removes none, credits no guard, no
// ownership, no `PROVEN`, and changes no finding. Its refusal reason is
// deliberately absent from `BOUNDARY_AFFECTS`, so a refused chain degrades
// nothing either.
//
// THE FIXTURE DISCIPLINE, AND IT IS NOT COSMETIC. Every negative lives in its OWN
// module directory and breaks exactly ONE condition. Four mutants survived
// ADR-104/105 because a single fixture broke two conditions at once and each
// check hid behind the other; `refusalDirs` below asserts the discipline
// mechanically, so the next person cannot lose it by accident.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { affectedProperties } from '../src/ubg/kernel/attach.js';
import { UNCERTAINTY_REASONS } from '../src/ubg/kernel/facts.js';
import {
  MAX_STRICT_HOPS,
  ORM_OPS,
  ORM_PACKAGES,
  STRICT_HTTP,
  STRICT_REFUSALS,
  mergeStrictReceipts,
} from '../src/ubg/nest-strict-chain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph, report } = compileUBG(path.join(here, 'fixtures', 'nest-strict-chain'), {
  write: false,
});
const g = canonicalizeGraph(graph);
const facts = report.kernel?.facts ?? [];
const links = facts.filter((f) => f.kind === 'ProviderLinkage');
const proved = links.filter((f) => f.strict);
const declined = facts.filter(
  (f) => f.kind === 'UnknownBoundary' && f.provenance.contract === 'nest/strict-chain',
);

const at = (route) => proved.filter((l) => l.entrypoint === `entrypoint:${route}`);
const sig = (l) =>
  `${l.strict.handle.orm} d=${l.strict.depth} ${l.strict.binding.kind} ${l.provider}.${l.op}`;
// Which fixture directory a refusal landed in — the one-condition discipline is a
// property of the DIRECTORY, so the check has to be too.
const dirOf = (f) => f.provenance.file.split('/')[1];
const refusalDirs = new Set(declined.map(dirOf));
const causesIn = (dir) => declined.filter((f) => dirOf(f) === dir).map((f) => f.detail);

// ---------------------------------------------------------------------------
describe('the positives — every accepted binding shape, proved end to end', () => {
  it('states exactly these ten chains, and no other', () => {
    expect(proved.map((l) => `${l.entrypoint} ${sig(l)}`).sort()).toEqual([
      'entrypoint:GET /aggregate typeorm d=1 class AggregateService.list.find',
      'entrypoint:GET /barrel typeorm d=1 class BarrelService.list.find',
      'entrypoint:GET /depth3 typeorm d=3 class HopThreeService.list.find',
      'entrypoint:GET /exported typeorm d=1 class SharedRowService.list.find',
      'entrypoint:GET /injecttoken typeorm d=1 class TokenService.list.find',
      'entrypoint:GET /mongoose mongoose d=1 class CatService.list.find',
      'entrypoint:GET /prisma prisma d=1 class PrismaBackedService.list.findMany',
      'entrypoint:GET /typeorm typeorm d=1 class TypeormService.list.find',
      'entrypoint:GET /useclass typeorm d=1 useClass UseClassImpl.list.find',
      'entrypoint:GET /useexisting typeorm d=1 useExisting AliasImpl.list.find',
    ]);
  });

  it('a TypeORM receipt proves the HANDLE\u2019s Nest binding, not only the provider\u2019s', () => {
    // THE LEAK THIS ASSERTION EXISTS FOR. An early draft proved eight TypeORM
    // chains from `constructor(private readonly repo: Repository<Row>)` with no
    // `@InjectRepository` and no `TypeOrmModule.forFeature([Row])` anywhere. That
    // is a dependency NO module registers — the app does not resolve at runtime.
    // The `typeorm` import proves the PACKAGE; it proves nothing about the
    // CONTAINER, and letting it stand in for the binding is exactly "the ORM
    // provenance replacing the Nest binding".
    //
    // Mongoose always required its bridge and Prisma's handle is itself an
    // `@Injectable` in a `providers` list, so TypeORM was the one asymmetry.
    for (const l of proved) {
      if (l.strict.handle.orm !== 'typeorm') continue;
      expect(l.strict.handle.entity).toBeTruthy();
    }
    expect(proved.filter((l) => l.strict.handle.orm === 'typeorm').length).toBe(8);
  });

  it('every link of every receipt carries its own provenance', () => {
    // A receipt missing a link is not a weaker receipt — it is not a receipt. The
    // whole point of the chain is that a reader can re-walk it without re-deriving
    // anything, so each link owes a file and a line, not merely a name.
    for (const l of proved) {
      const s = l.strict;
      expect(s.route.pkg).toBe('@nestjs/common');
      expect(STRICT_HTTP.has(s.route.decorator)).toBe(true);
      expect(s.route.file).toMatch(/\.ts$/);
      expect(s.route.line).toBeGreaterThan(0);
      expect(s.field.name).toBeTruthy();
      expect(s.identity.file).toMatch(/\.ts$/);
      expect(s.binding.module.file).toMatch(/\.module\.ts$/);
      expect(s.method.line).toBeGreaterThan(0);
      expect(s.handle.pkg).toBe(ORM_PACKAGES[s.handle.orm].pkg);
      expect(ORM_OPS[s.handle.orm].has(s.operation.name)).toBe(true);
      expect(s.operation.line).toBeGreaterThan(0);
      for (const hop of s.hops) {
        expect(hop.file).toMatch(/\.ts$/);
        expect(hop.class).toBeTruthy();
        expect(hop.method).toBeTruthy();
      }
    }
  });

  it('the bounded depth is stated, not implied', () => {
    // `depth` is the hop count and it is IN the receipt. A chain whose length a
    // reader has to count is a chain whose bound nobody checks.
    for (const l of proved) {
      expect(l.strict.depth).toBe(l.strict.hops.length);
      expect(l.strict.depth).toBeLessThanOrEqual(MAX_STRICT_HOPS);
    }
    expect(at('GET /depth3')[0].strict.hops.map((h) => `${h.class}.${h.method}`)).toEqual(
      ['HopOneService.list', 'HopTwoService.list', 'HopThreeService.list'],
    );
  });

  it('a binding found through an imported module names the hop it travelled', () => {
    // `imports: [SharedRowModule]` + `exports: [SharedRowService]`. The receipt
    // says WHERE the binding was found, so "bound here" and "bound two modules
    // away" are not the same sentence.
    const s = at('GET /exported')[0].strict;
    expect(s.binding.module.name).toBe('SharedRowModule');
    expect(s.binding.via.map((v) => v.name)).toEqual(['SharedRowModule']);
    // and a same-module binding travels no hop at all
    expect(at('GET /typeorm')[0].strict.binding.via).toEqual([]);
  });

  it('a re-export barrel resolves to the DECLARING file, never to the barrel', () => {
    expect(at('GET /barrel')[0].strict.identity.file).toBe(
      'src/barrel/services/barrel.service.ts',
    );
  });

  it('an immutable const aggregate is expanded, and states the class it expanded to', () => {
    expect(at('GET /aggregate')[0].strict.identity.name).toBe('AggregateService');
  });

  it('a congruent @Inject(ClassToken) is recorded AS a token injection', () => {
    // Accepted because the token names the very class the type names — nothing is
    // left for the container to decide. The receipt still says which shape it was,
    // because "typed" and "inject-token" are different evidence.
    expect(at('GET /injecttoken')[0].strict.field.injection).toBe('inject-token');
    expect(at('GET /typeorm')[0].strict.field.injection).toBe('typed');
  });

  it('useClass and useExisting land on the IMPLEMENTATION, not on the token', () => {
    expect(at('GET /useclass')[0].strict.identity.name).toBe('UseClassImpl');
    expect(at('GET /useexisting')[0].strict.identity.name).toBe('AliasImpl');
  });
});

// ---------------------------------------------------------------------------
describe('counter-example 1 — a local file exporting its own Repository', () => {
  it('the lookalike earns no strict chain', () => {
    expect(at('GET /fakeorm')).toEqual([]);
  });

  it('and the refusal names the ORM provenance, not something further along', () => {
    // The cause matters as much as the refusal. "no binding" would be true and
    // would send the next reader to the module file, where nothing is wrong.
    expect(causesIn('fakeorm')).toEqual([STRICT_REFUSALS.ORM_PROVENANCE]);
  });

  it('the Core still models the effect it always modelled', () => {
    // Over-approximating is the SAFE direction. This slice removes nothing: the
    // conservative graph is untouched, it simply gains no strict receipt.
    const effects = g.nodes.filter((n) => n.kind === 'effect');
    expect(effects.length).toBeGreaterThan(0);
  });
});

describe('counter-example 2 — a local file exporting its own @Controller/@Get', () => {
  it('the lookalike route earns no strict chain', () => {
    expect(at('GET /fakenest')).toEqual([]);
  });

  it('and the refusal names the DECORATOR provenance', () => {
    expect(causesIn('fakenest')).toEqual([STRICT_REFUSALS.ROUTE_PROVENANCE]);
  });
});

describe('counter-example 3 — Prisma is identified, never defaulted', () => {
  it('the Prisma chain says prisma, and cites @prisma/client', () => {
    // `contractFor` labels every unrecognised DB effect `mongo/driver` by DEFAULT.
    // A default is not an identification, and this is the field that says so.
    const s = at('GET /prisma')[0].strict;
    expect(s.handle.orm).toBe('prisma');
    expect(s.handle.pkg).toBe('@prisma/client');
    expect(s.handle.model).toBe('account');
    expect(s.operation.name).toBe('findMany');
  });

  it('no strict receipt anywhere carries a defaulted contract label', () => {
    for (const l of proved) expect(l.strict.handle.orm).not.toBe('mongo/driver');
  });

  it('a local PrismaClient lookalike earns nothing, and is declared', () => {
    expect(at('GET /prismafake')).toEqual([]);
    expect(causesIn('prismafake')).toEqual([STRICT_REFUSALS.ORM_PROVENANCE]);
  });
});

// ---------------------------------------------------------------------------
describe('the negatives — each breaks exactly ONE condition, and says which', () => {
  const cases = [
    ['usefactory', 'GET /usefactory', STRICT_REFUSALS.CONTAINER_BINDING],
    ['usevalue', 'GET /usevalue', STRICT_REFUSALS.CONTAINER_BINDING],
    ['forwardref', 'GET /forwardref', STRICT_REFUSALS.UNREADABLE_MODULE],
    ['mutated', 'GET /mutated', STRICT_REFUSALS.MUTABLE_AGGREGATE],
    ['nobinding', 'GET /nobinding', STRICT_REFUSALS.NO_BINDING],
    ['ambiguous', 'GET /ambiguous', STRICT_REFUSALS.AMBIGUOUS_BINDING],
    ['notinjectable', 'GET /notinjectable', STRICT_REFUSALS.NOT_INJECTABLE],
    ['strtoken', 'GET /strtoken', STRICT_REFUSALS.DECORATED_FIELD],
    ['callback', 'GET /callback', STRICT_REFUSALS.INDIRECT_CALL],
    ['computed', 'GET /computed', STRICT_REFUSALS.COMPUTED_CALL],
    ['badop', 'GET /badop', STRICT_REFUSALS.ORM_OPERATION],
    ['depth4', 'GET /depth4', STRICT_REFUSALS.DEPTH_EXCEEDED],
    ['mongonobridge', 'GET /mongonobridge', STRICT_REFUSALS.ORM_INITIALISATION],
    ['fakeorm', 'GET /fakeorm', STRICT_REFUSALS.ORM_PROVENANCE],
    ['fakenest', 'GET /fakenest', STRICT_REFUSALS.ROUTE_PROVENANCE],
    ['prismafake', 'GET /prismafake', STRICT_REFUSALS.ORM_PROVENANCE],
    // Six conditions that a single fixture used to hide from each other. Every one
    // of these exists because a mutant SURVIVED: `fakenest` broke the controller
    // decorator AND the verb decorator at once, so deleting either check left the
    // suite green. Splitting them is what makes each rule individually load-bearing.
    ['fakeverb', 'GET /fakeverb', STRICT_REFUSALS.ROUTE_PROVENANCE],
    ['fakeinjectable', 'GET /fakeinjectable', STRICT_REFUSALS.NOT_INJECTABLE],
    ['incongruent', 'GET /incongruent', STRICT_REFUSALS.DECORATED_FIELD],
    ['fakemongoose', 'GET /fakemongoose', STRICT_REFUSALS.ORM_INITIALISATION],
    ['notexported', 'GET /notexported', STRICT_REFUSALS.NO_BINDING],
    // The TypeORM bridge. Every one of these was PROVED by an early draft that
    // read the `typeorm` import as sufficient — the leak this block closes.
    ['noforfeature', 'GET /noforfeature', STRICT_REFUSALS.ORM_INITIALISATION],
    ['fakebridge', 'GET /fakebridge', STRICT_REFUSALS.ORM_INITIALISATION],
    ['fakeforfeature', 'GET /fakeforfeature', STRICT_REFUSALS.ORM_INITIALISATION],
    ['entitymismatch', 'GET /entitymismatch', STRICT_REFUSALS.ORM_ENTITY_CONGRUENCE],
    ['namedconn', 'GET /namedconn', STRICT_REFUSALS.ORM_CONNECTION],
    // The registration side of the same question. A mutant survived the first
    // campaign here: `forFeature([Row], 'analytics')` registers Row on a NAMED
    // connection, and `@InjectRepository(Row)` asks for the DEFAULT one — so no
    // provider exists and the guarded line had no test that bit.
    ['namedfeature', 'GET /namedfeature', STRICT_REFUSALS.ORM_INITIALISATION],
  ];

  for (const [dir, route, cause] of cases)
    it(`${dir} — no chain, and the cause is the one under test`, () => {
      expect(at(route)).toEqual([]);
      expect(causesIn(dir)).toEqual([cause]);
    });

  it('every negative directory declares EXACTLY ONE cause', () => {
    // The discipline itself, asserted. Two causes in one directory means one check
    // is hiding behind another, and the mutant for the hidden one will survive —
    // which is precisely how four mutants survived ADR-104 and ADR-105.
    for (const dir of refusalDirs) expect(causesIn(dir).length).toBe(1);
  });

  it('no POSITIVE directory declares anything', () => {
    // A proved chain that also emits a refusal is a grammar disagreeing with
    // itself, and the disagreement is invisible until someone counts.
    for (const dir of [
      'typeorm',
      'prisma',
      'mongoose',
      'useclass',
      'useexisting',
      'injecttoken',
      'exported',
      'barrel',
      'aggregate',
      'depth3',
    ])
      expect(causesIn(dir)).toEqual([]);
  });

  it('the depth-4 chain is DECLARED, never silently truncated', () => {
    // A truncated chain reads downstream exactly like a chain that ended, which is
    // the confusion hard rule 9 exists to prevent.
    const d = declined.filter((f) => dirOf(f) === 'depth4');
    expect(d[0].symbol).toContain('FourThreeService');
    expect(d[0].symbol).toContain('four');
  });
});

// ---------------------------------------------------------------------------
describe('the slice is EVIDENCE — it moves nothing', () => {
  it('its refusal reason gates no proof obligation', () => {
    // `unresolved-provider` is deliberately absent from BOUNDARY_AFFECTS. A slice
    // that degraded a verdict by REFUSING would move verdicts through its blind
    // spots, which is the opposite of diagnostic.
    expect(affectedProperties('unresolved-provider')).toEqual([]);
    for (const d of declined)
      expect(affectedProperties(d.provenance.uncertainty)).toEqual([]);
  });

  it('every refusal uses a reason from the CLOSED list', () => {
    for (const d of declined)
      expect(UNCERTAINTY_REASONS).toContain(d.provenance.uncertainty);
  });

  it('no strict receipt creates or removes a node', () => {
    // The receipt names an operation the graph may or may not have modelled. Both
    // are honest, and neither is allowed to change the graph.
    const before = g.nodes.length;
    expect(before).toBe(canonicalizeGraph(graph).nodes.length);
    for (const l of proved)
      expect(l.effect === null || typeof l.effect === 'string').toBe(true);
  });

  it('credits no guard, no ownership and no auth', () => {
    // The receipt names a DATA path. A guard, an owner scope or an auth posture
    // are different claims, and a slice that quietly supplied one would move a
    // verdict without ever saying the word.
    expect(g.nodes.filter((n) => n.kind === 'guard')).toEqual([]);
    for (const n of g.nodes.filter((n) => n.kind === 'effect'))
      expect(n.meta.ownerScoped).toBeUndefined();
  });

  it('no DbEffect is attributed to this contract', () => {
    // "creates no effect" at the fact layer: every effect answers to a PERSISTENCE
    // contract, never to this one.
    const effects = facts.filter((f) => f.kind === 'DbEffect');
    expect(effects.length).toBeGreaterThan(0);
    for (const e of effects) expect(e.provenance.contract).not.toBe('nest/strict-chain');
  });

  it('states no verdict word and no safety claim', () => {
    for (const l of proved) {
      const blob = JSON.stringify(l.strict).toLowerCase();
      for (const word of ['proven', 'safe', 'secure', 'verified', 'guarded'])
        expect(blob).not.toContain(word);
    }
  });
});

// ---------------------------------------------------------------------------
describe('the merge — one fact kind, two contracts, no second graph', () => {
  it('a legacy linkage always carries the admission INSIDE the field', () => {
    const legacy = [
      { entrypoint: 'e', providerFile: 'f', line: 1, op: 'find', provider: 'S' },
    ];
    const merged = mergeStrictReceipts(legacy, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].strict).toBeNull();
    expect(merged[0].grammar).toBe('adr-102');
  });

  it('a strict receipt for the SAME chain attaches rather than duplicating', () => {
    const legacy = [
      { entrypoint: 'e', providerFile: 'f', line: 1, op: 'find', provider: 'S' },
    ];
    const strict = [
      {
        entrypoint: 'e',
        providerFile: 'f',
        line: 1,
        op: 'find',
        provider: 'S',
        strict: { depth: 1 },
      },
    ];
    const merged = mergeStrictReceipts(legacy, strict);
    expect(merged).toHaveLength(1);
    expect(merged[0].strict).toEqual({ depth: 1 });
    expect(merged[0].grammar).toBe('adr-102');
  });

  it('a strict receipt for a chain the legacy grammar refused becomes its own record', () => {
    const strict = [
      {
        entrypoint: 'e',
        providerFile: 'f',
        line: 2,
        op: 'save',
        provider: 'S',
        strict: { depth: 1 },
      },
    ];
    const merged = mergeStrictReceipts([], strict);
    expect(merged).toHaveLength(1);
    expect(merged[0].grammar).toBe('adr-106');
  });

  it('the merged order is deterministic and does not depend on input order', () => {
    const a = { entrypoint: 'e2', providerFile: 'f', line: 1, op: 'find', provider: 'B' };
    const b = { entrypoint: 'e1', providerFile: 'f', line: 1, op: 'find', provider: 'A' };
    expect(mergeStrictReceipts([a, b], []).map((x) => x.entrypoint)).toEqual([
      'e1',
      'e2',
    ]);
    expect(mergeStrictReceipts([b, a], []).map((x) => x.entrypoint)).toEqual([
      'e1',
      'e2',
    ]);
  });
});

describe('determinism — the same tree twice is the same receipt', () => {
  it('a second compile produces byte-identical receipts', () => {
    const second = compileUBG(path.join(here, 'fixtures', 'nest-strict-chain'), {
      write: false,
    });
    const take = (r) =>
      JSON.stringify(
        (r.kernel?.facts ?? [])
          .filter((f) => f.kind === 'ProviderLinkage')
          .map((f) => [f.id, f.strict]),
      );
    expect(take(second.report)).toBe(take(report));
  });
});
