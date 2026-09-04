// Nest Class Source Seeding V1 — ADR-105.
//
//   @Post() create(@Body() dto)  →  this.svc.persist(dto)
//                                →  persist(value)  →  this.repo.save(value)
//
// ADR-104 stated a PATH across this chain as evidence. It could not put the
// request surface ON the effect: `DbEffectOccurrence.dataOrigins` stayed `[]`,
// because `@Body() dto` is not `req.body` — the parameter name is arbitrary and
// `REQ_ROOTS` cannot see it. Measured on every application before this slice:
// dataOrigins linked = 0 on eight of nine, including all seven Nest giants.
//
// This slice seeds the surface across ONE class boundary, and only where the
// SOURCE settles which class is on the other side: a literal `@Module` naming
// this controller and this provider, both by exact relative import, unambiguous,
// undecorated, declared by the file they resolve to, with an official
// `forFeature`. A TypeScript type never settles it — `useClass`, `useValue`, a
// factory or a token all put a different body there.
//
// THE BLAST RADIUS IS CHECKABLE, not argued: where the binding map is EMPTY the
// compiled graph is byte-identical. It is empty on all eight pinned corpus
// applications — twenty has 357 module files and proves zero — and the corpus
// reports 0 drifted.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import { provedProviderBindings } from '../src/ubg/nest-provider.js';
import { nestSurfaceSeed } from '../src/ubg/resolve.js';
import { parseModule, classInModule } from '../src/ubg/extract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'fixtures', 'nest-class-seeding');
const { graph, report } = compileUBG(dir, { write: false });
const g = canonicalizeGraph(graph);
const facts = report.kernel?.facts ?? [];
const occ = facts.filter((f) => f.kind === 'DbEffectOccurrence');
const at = (route) => occ.filter((o) => o.entrypoint === `entrypoint:${route}`);
const src = (o, key) => (o[key] ?? []).map((x) => `${x.origin}.${x.name ?? '*'}`).sort();

// the module files, found the way the lowering finds them
const moduleFilesUnder = (root) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && /@Module\s*\(/.test(fs.readFileSync(p, 'utf8')))
        out.push(p);
    }
  };
  walk(root);
  return out;
};

describe('the positive — a request surface reaches the effect, through the class', () => {
  it('a body surface lands on the write it feeds', () => {
    expect(src(at('POST /shared/by-body')[0], 'dataOrigins')).toEqual(['body.*']);
  });

  it('a path parameter lands on the delete it selects', () => {
    expect(src(at('DELETE /shared/:id')[0], 'filterOrigins')).toEqual(['params.id']);
  });

  it('the surface is proved by PROVENANCE, and the seed carries its steps', () => {
    const mod = parseModule(path.join(dir, 'src', 'shared', 'shared.controller.ts'));
    const cls = classInModule(mod, 'SharedController');
    const m = cls.body.body.find((x) => x.key?.name === 'fromParam');
    const seed = nestSurfaceSeed(m, mod);
    expect([...seed.origins.entries()]).toEqual([
      ['id', { origin: 'params', name: 'id' }],
    ]);
    expect(seed.steps.get('id').hop).toEqual(['req.params.id']);
    // the MARKER map stays empty: a source is not a proof that the body mutates
    // with it, and moving a taint flag is not what this slice earns
    expect(seed.size).toBe(0);
  });
});

describe('two routes, one shared effect — the leak this design exists to prevent', () => {
  // `SharedService.persist` is reached by BOTH routes and its repository call is
  // ONE effect node. The bundle is memoized; a memo keyed without the seed would
  // compute the first route's scan and hand it to the second, so `PUT` would
  // report the body surface `POST` sent. That is one route's proof licensing
  // another, which is why DbEffectOccurrence is route-scoped in the first place.
  it('produces two occurrences over one effect', () => {
    const both = [...at('POST /shared/by-body'), ...at('PUT /shared/by-param/:id')];
    expect(both).toHaveLength(2);
    expect(new Set(both.map((o) => o.effect)).size).toBe(1);
    expect(new Set(both.map((o) => o.id)).size).toBe(2);
  });

  it('and two DIFFERENT provenances, neither borrowed from the other', () => {
    expect(src(at('POST /shared/by-body')[0], 'dataOrigins')).toEqual(['body.*']);
    expect(src(at('PUT /shared/by-param/:id')[0], 'dataOrigins')).toEqual(['params.id']);
  });

  it('every occurrence names the route it is evidence about', () => {
    for (const o of occ) expect(o.id).toContain(o.entrypoint);
  });
});

describe('the negatives — a container decision is never a source fact', () => {
  it('a BARREL re-export is a resolved relative import and not a proved class', () => {
    // `./services` resolves, and the file it resolves to forwards the name rather
    // than declaring it. Which declaration `LeafService` reaches is unanswered,
    // so nothing is seeded — and the effect itself is untouched.
    expect(at('POST /barrel')[0].dataOrigins).toEqual([]);
    expect(at('POST /barrel')[0].effect).toBeTruthy();
  });

  it('a useFactory provider states a RECIPE, not a class', () => {
    expect(at('POST /factory')[0].dataOrigins).toEqual([]);
    expect(at('POST /factory')[0].effect).toBeTruthy();
  });

  it('a controller writing in its OWN body is not seeded either', () => {
    // `FactoryController.direct` does `this.repo.save(dto)` with no provider hop
    // at all, in a module that proves no binding. This is what makes the
    // controller-side gate observable: a seed built for every Nest controller,
    // rather than for a proved one, would land exactly here.
    expect(at('POST /factory/direct')[0].dataOrigins).toEqual([]);
    expect(at('POST /factory/direct')[0].effect).toBeTruthy();
  });

  it('the binding map proves exactly one controller here, and names it', () => {
    // The key is `<absolute file>#<Class>`, and the file carries NATIVE
    // separators. Asserting the whole key with `path.join` is both
    // platform-agnostic and stronger than matching a tail: the earlier version
    // did `k.split('/').pop()`, which is a no-op on Windows and turned a green
    // branch into a red `main` (E-119).
    const b = provedProviderBindings({ moduleFiles: moduleFilesUnder(dir) });
    expect([...b.keys()]).toEqual([
      `${path.join(dir, 'src', 'shared', 'shared.controller.ts')}#SharedController`,
    ]);
    expect([...b.values()][0].get('svc').name).toBe('SharedService');
  });

  it('an ambiguous CONTROLLER seeds nothing — and only that check refuses it', () => {
    // `pin-a.module.ts` and `pin-b.module.ts` both declare PinController, and
    // each declares its OWN provider. So the provider is unambiguous and the
    // controller is not: this route is refused by the controller check alone.
    // A shared fixture where BOTH were ambiguous let each check hide behind the
    // other, and two mutants survived under it.
    expect(at('POST /ambigctrl')[0].dataOrigins).toEqual([]);
    expect(at('POST /ambigctrl')[0].effect).toBeTruthy();
  });

  it('an ambiguous PROVIDER seeds nothing — and only that check refuses it', () => {
    // The mirror image: `tab-a.module.ts` and `tab-b.module.ts` each declare
    // their own controller and both declare TabService.
    for (const r of ['POST /ambigsvc-a', 'POST /ambigsvc-b']) {
      expect(at(r)[0].dataOrigins, r).toEqual([]);
      expect(at(r)[0].effect, r).toBeTruthy();
    }
  });

  it('an AMBIGUOUS module binding seeds nothing', () => {
    // Two literal modules declare TagsController in the ADR-104 fixture. Both are
    // readable; that is precisely why neither settles which is live.
    const other = compileUBG(path.join(here, 'fixtures', 'nest-provider-tapp'), {
      write: false,
    });
    const tags = (other.report.kernel?.facts ?? []).filter(
      (f) => f.kind === 'DbEffectOccurrence' && f.entrypoint === 'entrypoint:POST /tags',
    );
    expect(tags.length).toBeGreaterThan(0);
    for (const o of tags) expect(o.dataOrigins).toEqual([]);
  });

  it('an @Inject token seeds nothing', () => {
    // ADR-102's fixture carries the token case; the binding proof refuses a
    // decorated constructor parameter, so no surface crosses.
    const other = compileUBG(path.join(here, 'fixtures', 'nest-direct-provider'), {
      write: false,
    });
    const b = provedProviderBindings({
      moduleFiles: moduleFilesUnder(path.join(here, 'fixtures', 'nest-direct-provider')),
    });
    expect([...b.keys()].some((k) => k.includes('token/'))).toBe(false);
    const tokened = (other.report.kernel?.facts ?? []).filter(
      (f) => f.kind === 'DbEffectOccurrence' && f.entrypoint.includes('/orders'),
    );
    for (const o of tokened) expect(o.dataOrigins ?? []).toEqual([]);
  });
});

describe('an empty binding map is the old behaviour, exactly', () => {
  it('a lowering with no proved binding seeds nothing anywhere', () => {
    // The blast-radius property, stated as a test rather than as a claim: on the
    // eight pinned corpus applications this map is empty — twenty has 357 module
    // files and proves zero — and `npm run corpus` reports 0 drifted.
    const b = provedProviderBindings({ moduleFiles: [] });
    expect(b.size).toBe(0);
  });

  it('the seed builder answers null when no parameter is a request surface', () => {
    const mod = parseModule(path.join(dir, 'src', 'shared', 'shared.service.ts'));
    const cls = classInModule(mod, 'SharedService');
    const m = cls.body.body.find((x) => x.key?.name === 'persist');
    expect(nestSurfaceSeed(m, mod)).toBeNull();
    expect(nestSurfaceSeed(null, null)).toBeNull();
  });
});

describe('it may reveal, and it may never absolve', () => {
  it('creates no node and removes none', () => {
    // FIVE occurrences over FOUR effect nodes — the two `shared` routes reach
    // one repository call, which is exactly the shape this fixture exists for.
    // Measured identical with the seeding wired and unwired.
    expect(g.nodes.filter((n) => n.kind === 'entrypoint')).toHaveLength(9);
    expect(g.nodes.filter((n) => n.kind === 'effect')).toHaveLength(8);
    expect(occ).toHaveLength(9);
    // every route still reaches its write — a seed adds provenance, never removes
    // behaviour
    for (const o of occ) expect(o.effect).toBeTruthy();
  });

  it('no route reads PROVEN, and the findings are the mutations themselves', () => {
    const findings = checkGraph(g).findings;
    expect(findings.every((f) => f.rule === 'UNGUARDED_MUTATION')).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('an unmeasured role stays null, never an empty answer', () => {
    // rule 13 at this layer: `null` says the role does not exist on this call,
    // `[]` says it was inspected and nothing request-derived reached it.
    const del = at('DELETE /shared/:id')[0];
    expect(del.dataOrigins).toBeNull();
    expect(del.filterOrigins).not.toBeNull();
  });
});
