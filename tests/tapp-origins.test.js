// TAPP-0 — request origins for every modelled DB contract, not just Mongo.
//
// `originsIn` has answered "which request surfaces reached this expression" since
// the Mongo driver contract shipped. It was wired to that ONE branch, so Prisma,
// TypeORM, Knex/Supabase and active-record produced DB occurrences with zero
// origin linkage — measured on the corpus: cal.com 169 occurrences / 0 origins,
// twenty 1199 / 0, immich 1110 / 0. The analyser could see the effect and could
// see the request, and nothing joined them.
//
// This is not a new origin implementation per ORM. There is ONE helper
// (`originRoles`); each contract supplies only its own argument roles, because
// those genuinely differ — Prisma names them (`where`/`data`), TypeORM is
// positional and varies by method, a builder carries the document at THIS call
// and its filter in a different link of the chain.
//
// THREE STATES, and keeping them apart is the contract:
//   [ … ]  origins found
//   [ ]    inspected, none — an ANSWER
//   null   not measurable: the role is absent on this call, there is no request
//          binding map, or the argument is opaque. NOT an empty answer.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { report } = compileUBG(path.join(here, 'fixtures', 'tapp-origins'), {
  write: false,
});
const occurrences = (report.kernel?.facts ?? []).filter(
  (f) => f.kind === 'DbEffectOccurrence',
);
const at = (route) => occurrences.filter((o) => o.entrypoint === `entrypoint:${route}`);
const one = (route) => {
  const hits = at(route);
  expect(hits, route).toHaveLength(1);
  return hits[0];
};
const names = (list) => (list ?? []).map((o) => `${o.origin}.${o.name ?? '*'}`).sort();

describe('1 — Prisma: the roles are the contract’s own option keys', () => {
  it('req.body reaches the written data', () => {
    const o = one('POST /prisma/users');
    expect(names(o.dataOrigins)).toContain('body.email');
    // a `create` has no `where`: the role does not exist, so it is null
    expect(o.filterOrigins).toBeNull();
  });

  it('req.params reaches the filter and req.body the data, separately', () => {
    const o = one('POST /prisma/users/:id');
    expect(names(o.filterOrigins)).toContain('params.id');
    expect(names(o.dataOrigins)).toContain('body.name');
    // the distinction is the point — a client-chosen FILTER is an object-scope
    // question, a client-chosen PAYLOAD is a validation question
    expect(names(o.filterOrigins)).not.toContain('body.name');
    expect(names(o.dataOrigins)).not.toContain('params.id');
  });
});

describe('2 — Knex/Supabase builder', () => {
  it('the document at this call carries the origin', () => {
    const o = one('POST /knex/accounts');
    expect(names(o.dataOrigins)).toContain('body.email');
  });

  it('the filter is genuinely NOT at this call — null, not an empty answer', () => {
    // on a builder the filter lives in a separate `.where(...)` link, so this
    // call has no filter role at all. `[]` would claim an inspection that never
    // happened.
    expect(one('POST /knex/accounts').filterOrigins).toBeNull();
  });
});

describe('3 — active record: values first, options second', () => {
  it('a write takes its data from argument 0', () => {
    expect(names(one('POST /ar/posts').dataOrigins)).toContain('body.title');
  });

  it('a read takes its filter from the options `where`', () => {
    const o = one('GET /ar/posts/:id');
    expect(names(o.filterOrigins)).toContain('params.id');
    // a select writes nothing: the data role does not exist
    expect(o.dataOrigins).toBeNull();
  });
});

describe('4 — an independent value invents no origin', () => {
  it('a literal payload is inspected and reports NOTHING — an answer, not null', () => {
    const o = one('POST /static');
    expect(o.dataOrigins).toEqual([]);
    expect(o.dataOrigins).not.toBeNull();
  });
});

describe('5 — an unmeasurable expression is null, never a lying []', () => {
  it('a computed access path declares the limit instead of inventing an origin', () => {
    // `db('settings').insert(req.body[key])` — the property is computed, so the
    // access path is not statically representable. Reporting `[]` here would say
    // "inspected, no request data involved" about an expression that is entirely
    // request-derived: the most dangerous direction available.
    const o = one('POST /dynamic');
    expect(o.dataOrigins).toBeNull();
    expect(o.dataOrigins).not.toEqual([]);
  });
});

describe('5b — an opaque producer is unmeasurable, not empty', () => {
  it('a document built by a function this body cannot open reports null', () => {
    // `db('reports').insert(buildReport(req.body))` — the payload is entirely
    // request-derived and `originsIn` cannot see inside `buildReport`. `[]` would
    // read as "inspected, no request data involved": the dangerous direction.
    const o = one('POST /opaque');
    expect(o.dataOrigins).toBeNull();
    expect(o.dataOrigins).not.toEqual([]);
  });
});

describe('6 — two routes on one handler keep their own provenance', () => {
  it('both routes reach the SAME canonical effect', () => {
    // if this stops being true the test below proves nothing
    const a = one('GET /shared/a/:id');
    const b = one('GET /shared/b/:id');
    expect(a.effect).toBe(b.effect);
    expect(a.id).not.toBe(b.id);
  });

  it('the origins live on the OCCURRENCE, so nothing is merged across routes', () => {
    // The shared effect NODE unions origins by design (one more client-chosen
    // origin can only widen an advisory). The occurrence is where a per-route
    // proof lives, and it is what TAPP reads.
    for (const route of ['GET /shared/a/:id', 'GET /shared/b/:id']) {
      const o = one(route);
      expect(o.entrypoint).toBe(`entrypoint:${route}`);
      expect(names(o.filterOrigins)).toContain('params.id');
    }
  });
});

describe('7 — provenance survives on every occurrence', () => {
  it('each occurrence names its route, owner, effect, file and line', () => {
    expect(occurrences.length).toBeGreaterThan(0);
    for (const o of occurrences) {
      expect(o.entrypoint).toMatch(/^entrypoint:/);
      expect(o.owner).toMatch(/^logic:/);
      expect(o.effect).toMatch(/^effect:/);
      expect(o.provenance.file).toBe('src/server.js');
      expect(o.provenance.line).toBeGreaterThan(0);
    }
  });

  it('every role is one of the three states — never undefined', () => {
    for (const o of occurrences)
      for (const key of ['filterOrigins', 'dataOrigins']) {
        const v = o[key];
        expect(v === null || Array.isArray(v), `${o.entrypoint} ${key}`).toBe(true);
      }
  });
});

describe('8 — no finding, no verdict, no lost effect', () => {
  it('TAPP-0 is descriptive: the effects are all still there', () => {
    // seven DB calls in the fixture; origins may never remove one
    const tables = [...new Set(occurrences.map((o) => o.table))].sort();
    expect(tables).toEqual(['accounts', 'audit', 'post', 'reports', 'settings', 'user']);
  });
});
