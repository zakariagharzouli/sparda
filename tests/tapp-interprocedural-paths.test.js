// TAPP-2 V1 — one real multi-file trajectory, and every refusal beside it.
//
//   route → req.body → handler factory → captured DAO instance → positional
//   argument → DAO parameter → Mongo filter/data
//
// TAPP-1 could state a path inside ONE body and had to declare every hop that
// left it. Measured on real NodeGoat that was 0 resolved out of 10, because its
// entire request-to-effect path crosses a call boundary. This slice crosses that
// ONE boundary, and only when every identity on it is statically resolved:
// the receiver, the instance, the method body, the parameter positions.
//
// The seam is deliberately narrow. It carries a STEP, not a conclusion: the
// origin has crossed this boundary since ADR-066 and its behaviour is untouched
// here. What is new is the claim about WHICH value landed in WHICH parameter, and
// that claim is refused whole — for the entire call — the moment a spread, a rest
// parameter or a rebinding makes a position mean something else.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { UNKNOWN_ACCESS_PATH } from '../src/ubg/kernel/facts.js';
import { STEP_KINDS } from '../src/ubg/extract.js';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph, report } = compileUBG(
  path.join(here, 'fixtures', 'tapp-interprocedural'),
  { write: false },
);
const g = canonicalizeGraph(graph);
const facts = report.kernel?.facts ?? [];
const paths = facts.filter((f) => f.kind === 'DataFlowPath');
const occurrences = facts.filter((f) => f.kind === 'DbEffectOccurrence');
const boundaries = facts.filter((f) => f.kind === 'UnknownBoundary');

const at = (route, role) =>
  paths.filter((f) => f.entrypoint === `entrypoint:${route}` && f.role === role);
const stated = (route, role) =>
  at(route, role)
    .filter((f) => f.state === 'resolved')
    .map((f) => f.path.join(' → '));
const declared = (route, role) => at(route, role).filter((f) => f.state === 'unknown');

describe('1 — the target trajectory, end to end, across two files', () => {
  it('the client-chosen id reaches the Mongo FILTER, every step named', () => {
    expect(stated('POST /benefits', 'filter')).toEqual([
      'req.body.userId → userId → BenefitsDAO.updateBenefits(#0) → userId → parseInt() → filter._id',
    ]);
  });

  it('the client-chosen date reaches the WRITTEN DATA, every step named', () => {
    expect(stated('POST /benefits', 'data')).toEqual([
      'req.body.benefitStartDate → benefitStartDate → BenefitsDAO.updateBenefits(#1) → startDate → data.$set.benefitStartDate',
    ]);
  });

  it('the hop is named by what RESOLVED, never by the receiver variable', () => {
    // `benefitsDAO` is a local alias. Naming it would make the evidence a
    // statement about a name; `BenefitsDAO.updateBenefits` is the class and the
    // member the walk actually resolved.
    for (const p of stated('POST /benefits', 'filter'))
      expect(p).not.toContain('benefitsDAO.');
  });

  it('the fact still carries the route, the owning body and the canonical effect', () => {
    const [fact] = at('POST /benefits', 'filter').filter((f) => f.state === 'resolved');
    expect(fact.entrypoint).toBe('entrypoint:POST /benefits');
    expect(fact.owner).toMatch(/^logic:/);
    expect(fact.effect).toMatch(/^effect:db_write:/);
  });
});

describe('2 — provenance follows the POSITION, never the name', () => {
  it('the caller passes them CROSSED, and the evidence follows the slots', () => {
    // `ordersDAO.place(orderId, note)` into `place(note, orderId)`: every name
    // points at the wrong slot. So `data.$set.note` — filled from the parameter
    // named `note` — really does carry the PATH id, and `filter._id` really does
    // carry the BODY note. A binding that matched on names would produce the
    // comfortable answer and be wrong twice.
    expect(stated('POST /orders/:id', 'data')).toEqual([
      'req.params.id → orderId → OrdersDAO.place(#0) → note → data.$set.note',
    ]);
    expect(stated('POST /orders/:id', 'filter')).toEqual([
      'req.body.note → note → OrdersDAO.place(#1) → orderId → filter._id',
    ]);
  });

  it('the comfortable, name-matched answer does not appear anywhere', () => {
    const all = [
      ...stated('POST /orders/:id', 'data'),
      ...stated('POST /orders/:id', 'filter'),
    ].join('\n');
    expect(all).not.toContain('req.body.note → note → OrdersDAO.place(#0)');
    expect(all).not.toContain('req.params.id → orderId → OrdersDAO.place(#1)');
  });
});

describe('3 — two routes, one DAO method: no proof is shared', () => {
  it('each route carries its own surface through the same parameter', () => {
    expect(stated('GET /owner/:owner', 'filter')).toEqual([
      'req.params.owner → BenefitsDAO.findByOwner(#0) → ownerId → filter.owner',
    ]);
    expect(stated('GET /owner', 'filter')).toEqual([
      'req.query.owner → BenefitsDAO.findByOwner(#0) → ownerId → filter.owner',
    ]);
  });

  it('the DB node is shared and the facts are not', () => {
    const a = at('GET /owner/:owner', 'filter')[0];
    const b = at('GET /owner', 'filter')[0];
    expect(a.effect).toBe(b.effect);
    expect(a.id).not.toBe(b.id);
    expect(a.source.origin).toBe('params');
    expect(b.source.origin).toBe('query');
  });
});

describe('4-6 — every unresolved identity stays a named boundary', () => {
  const cases = [
    [
      'a REASSIGNED parameter — the value written is not the value passed',
      'POST /rewrite',
      'filter',
    ],
    [
      'a SPREAD argument — no position is determined, including the safe-looking ones',
      'POST /spread',
      'filter',
    ],
    ['a REST parameter — "position i" stops meaning one argument', 'GET /rest', 'filter'],
    [
      'DUPLICATE parameter names — the position no longer identifies a binding',
      'GET /duplicate',
      'filter',
    ],
  ];
  for (const [title, route, role] of cases)
    it(`${title}`, () => {
      expect(declared(route, role).length, route).toBeGreaterThan(0);
      for (const f of declared(route, role)) {
        expect(f.boundary).toBe(UNKNOWN_ACCESS_PATH);
        expect(f.path).toBeNull();
      }
      expect(stated(route, role), route).toEqual([]);
    });

  it('a MULTI-argument inline transform apportions nothing', () => {
    // `joinWith(key, 'suffix')` is not a function of `key` alone. Stating a path
    // through it would attribute to one input a value two produced.
    expect(stated('GET /combined', 'filter')).toEqual([]);
    expect(declared('GET /combined', 'filter').length).toBeGreaterThan(0);
  });

  it('an unresolved RECEIVER and a COMPUTED method reach no effect and invent no route', () => {
    // Neither produces an occurrence at all — there is no resolved body to walk.
    // What must never happen is a path appearing for them.
    for (const route of ['POST /unresolved', 'POST /computed'])
      expect(paths.filter((f) => f.entrypoint === `entrypoint:${route}`)).toEqual([]);
  });

  it('a member that is not on the resolved instance is DECLARED, not skipped', () => {
    // the receiver resolved and the member did not — a real behavioural hop that
    // ends here, and the fact that keeps the route from reading clean by omission
    const named = boundaries.filter((b) => (b.symbol ?? '').includes('notThere'));
    expect(named.length).toBeGreaterThan(0);
  });
});

describe('7 — a callback is never a proof of completion', () => {
  it('no path is ever stated through the callback parameter', () => {
    // Every DAO method here takes a Node callback. The Mongo effect happens in
    // the DAO body BEFORE it runs, which is why the argument→parameter flow is
    // provable without understanding the continuation — and precisely why the
    // continuation itself must contribute nothing.
    for (const f of paths) {
      expect(f.path?.join(' ') ?? '').not.toContain('callback');
      expect(f.destination ?? '').not.toContain('callback');
    }
  });

  it('the callback argument binds no parameter of its own', () => {
    for (const f of paths.filter((x) => x.state === 'resolved'))
      expect(f.path.some((s) => /\(#\d\)$/.test(s))).toBe(true);
  });
});

describe('8 & 9 — the effect survives, and nothing is credited', () => {
  it('a DB effect whose hop is unknown is still a DB effect', () => {
    const rewrite = occurrences.filter(
      (o) => o.entrypoint === 'entrypoint:POST /rewrite',
    );
    expect(rewrite).toHaveLength(1);
    expect(rewrite[0].access).toBe('write');
    expect(rewrite[0].table).toBe('users');
  });

  it('this slice credits no guard, no ownership, no auth', () => {
    expect(g.nodes.filter((n) => n.kind === 'guard')).toEqual([]);
    for (const n of g.nodes.filter((n) => n.kind === 'effect'))
      expect(n.meta.ownerScoped).toBeUndefined();
  });

  it('every fact is evidence — none carries a verdict word', () => {
    for (const f of paths) {
      expect(['resolved', 'unknown']).toContain(f.state);
      expect(f).not.toHaveProperty('proven');
      expect(f).not.toHaveProperty('safe');
    }
  });
});

describe('the reconciliation still holds across the seam', () => {
  it('every origin has an entry, resolved or declared', () => {
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
          const k = `${origin.origin}.${origin.name ?? '*'}`;
          const prefixOfResolved =
            origin.name == null &&
            [...covered].some((c) => c.startsWith(`${origin.origin}.`) && c !== k);
          expect(covered.has(k) || prefixOfResolved, `${o.entrypoint} ${k}`).toBe(true);
        }
      }
  });
});

describe('the reader knows every step kind that is written — a wiring rule', () => {
  // Not a behaviour test, and it cannot be one: `localChain` refuses an
  // unrecognised `via`, so with every kind recognised the refusal is unobservable.
  // The property is WIRING — "every writer uses a kind the reader knows" — and
  // wiring cannot be observed by running one input, which is exactly how four
  // call sites once stayed unwired under a green suite (E-106).
  //
  // The failure it exists to prevent was MEASURED on this branch, not imagined: an
  // unrecognised kind used to fall through and yield a TRUNCATED path —
  // `req.body.benefitStartDate → startDate → data.$set.benefitStartDate`, with a
  // whole interprocedural hop erased and the fact still reading `resolved`.
  const SOURCES = ['src/ubg/extract.js', 'src/ubg/resolve.js'];
  const written = SOURCES.flatMap((f) => {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    return [...src.matchAll(/\bvia:\s*'([^']+)'/g)].map((m) => ({ file: f, kind: m[1] }));
  });

  it('is not vacuous — these are the sites it checks', () => {
    // a rule that quietly stops matching is a rule that stopped existing
    expect(written.length).toBeGreaterThanOrEqual(5);
    expect(new Set(written.map((w) => w.file)).size).toBe(2);
  });

  it('every step kind written anywhere is one the reader can state', () => {
    for (const w of written)
      expect([...STEP_KINDS], `${w.file} writes via: '${w.kind}'`).toContain(w.kind);
  });
});
