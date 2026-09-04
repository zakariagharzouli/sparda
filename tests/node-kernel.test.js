// Node Semantic Kernel — the first slice, pinned.
//
// The chain under test is the one the mission names:
//   HTTP request → route → async → handler/service → Mongo → DB effect
//
// Every assertion here is structural. None of them asserts that an application
// is safe; they assert what the kernel could and could not PROVE, which is the
// only thing it is allowed to say.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import {
  DATA_ORIGINS,
  FACT_KINDS,
  UNCERTAINTY_REASONS,
  guardBoundaryProof,
  makeFact,
  summarizeLedger,
  createLedger,
  record,
} from '../src/ubg/kernel/facts.js';
import { CONTRACTS, MONGO_COLLECTION_OPS } from '../src/ubg/kernel/contracts.js';
import { scopeBindings, captureChain } from '../src/ubg/kernel/bindings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, 'fixtures', name);

const compile = (name) => compileUBG(fixture(name), { write: false });
const factsOf = (report, kind) => report.kernel.facts.filter((f) => f.kind === kind);

describe('Node Semantic Kernel — Express → async → service → Mongo → effect', () => {
  const { report } = compile('node-kernel-express-mongo');

  it('links a captured Mongo collection through a CommonJS DAO to a DB effect', () => {
    const effects = factsOf(report, 'DbEffect');
    const tables = [...new Set(effects.map((f) => f.table))].sort();
    // `orders` and `audit` are only reachable through `db.collection(<literal>)`
    // captured in the DAO constructor's scope — the whole point of the slice.
    expect(tables).toEqual(['audit', 'orders']);
    for (const effect of effects) {
      expect(effect.provenance.contract).toBe('mongo/driver');
      // The provenance names the DECLARING file, not the route file: an effect
      // whose position points at another file is unusable as a ledger (E-099).
      expect(effect.provenance.file).toBe('src/data/orders-dao.js');
      expect(effect.provenance.line).toBeGreaterThan(0);
    }
  });

  it('reads the op, the filter and the modified data of a Mongo write', () => {
    const update = factsOf(report, 'DbEffect').find((f) => f.op === 'update');
    expect(update).toBeDefined();
    expect(update.access).toBe('write');
    expect(update.table).toBe('orders');
    // The filter is READ, not guessed: literal pairs only.
    expect(update.filter).toEqual({ status: 'open' });
    expect(update.symbolicTarget).toBe(false);
  });

  it('recognises the three async continuation forms, and nothing else', () => {
    const continuations = factsOf(report, 'AsyncContinuation');
    const forms = new Set(continuations.map((f) => f.form));
    // await (cancelOrder), .then (purgeOrders), positional callback (displayOrder)
    expect(forms).toEqual(new Set(['await', 'then', 'callback']));
    // The COUNT is the half that bites: a continuation model that accepts any
    // trailing function argument still produces these three forms, while also
    // recording `.then(() => …)` a second time as a callback. Then the ledger
    // describes JavaScript's higher-order calls instead of the program's async
    // structure, and `byKind` stops being a number anyone can act on.
    expect(continuations).toHaveLength(3);
  });

  it('records the HTTP data source of each route parameter', () => {
    const sources = factsOf(report, 'DataSource');
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(DATA_ORIGINS).toContain(source.origin);
      expect(source.provenance.contract).toBe('express/router');
    }
    expect(sources.map((s) => s.name)).toContain('orderId');
  });

  it('credits a guard only on the four structural obligations', () => {
    const guards = factsOf(report, 'GuardBoundary');
    const credited = guards.filter((g) => g.credited);
    expect(credited.length).toBeGreaterThan(0);
    for (const guard of credited) {
      expect(guard.onRouteChain).toBe(true);
      expect(guard.denyPathProven).toBe(true);
      expect(guard.allowPathReachesHandler).toBe(true);
      expect(guard.mutationDominated).toBe(true);
      expect(guard.unmet).toEqual([]);
    }
    // The mutating route discharges dominance for real, not vacuously.
    const mutating = guards.find(
      (g) => g.entrypoint === 'entrypoint:POST /orders/:orderId/cancel',
    );
    expect(mutating.vacuousDominance).toBe(false);
    expect(mutating.credited).toBe(true);
  });

  it('conserves every fact across the lift boundary', () => {
    const conservation = report.kernel.conservation;
    expect(conservation.balance.balanced).toBe(true);
    expect(conservation.informationLost).toEqual([]);
    expect(conservation.factsAfter.length).toBe(report.kernel.total);
  });
});

describe('Node Semantic Kernel — what it refuses to claim', () => {
  const { report } = compile('node-kernel-unknown');

  it('does not credit a guard that is named like one and only calls next()', () => {
    const guard = factsOf(report, 'GuardBoundary').find((g) =>
      g.guard.includes('looksLikeAuth'),
    );
    expect(guard).toBeDefined();
    expect(guard.credited).toBe(false);
    expect(guard.denyPathProven).toBe(false);
    expect(guard.unmet).toContain('denyPathProven');
    expect(guard.provenance.uncertainty).toBe('no-deny-path');
  });

  it('declares an unresolved service hop instead of dropping it', () => {
    const unknown = factsOf(report, 'UnknownBoundary');
    expect(unknown.length).toBeGreaterThan(0);
    const archive = unknown.find((f) => f.symbol?.includes('archive'));
    expect(archive).toBeDefined();
    expect(archive.provenance.uncertainty).toBe('unresolved-module');
    expect(archive.provenance.contract).toBe('node/resolve');
  });

  it('reports the route as measurably incomplete, and never as complete', () => {
    // Incompleteness is provable; completeness is not. `true` must be
    // unreachable — reading "no stop was recorded" as "the walk saw
    // everything" is the E-104 mistake one layer down.
    expect(report.kernel.complete).toBe(false);
    expect(report.kernel.unknownBoundaries).toBeGreaterThan(0);
  });

  it('produces no DB effect for a hop it could not resolve', () => {
    // The DAO's real collection exists, but `archive` does not: inventing an
    // effect here would be fabricating behavior (SOUNDNESS Direction 2).
    expect(factsOf(report, 'DbEffect')).toEqual([]);
  });
});

describe('Node Semantic Kernel — the fact model itself', () => {
  it('never lets an UnknownBoundary omit its cause', () => {
    expect(() =>
      makeFact('UnknownBoundary', 'x', {}, { file: 'a.js', contract: 'node/resolve' }),
    ).toThrow(/must name its uncertainty/);
  });

  it('rejects a provenance with no responsible contract', () => {
    expect(() => makeFact('DbEffect', 'x', {}, { file: 'a.js' })).toThrow(
      /needs a contract/,
    );
  });

  it('rejects an uncertainty reason that is not in the closed list', () => {
    expect(() =>
      makeFact(
        'UnknownBoundary',
        'x',
        {},
        { file: 'a.js', contract: 'node/resolve', uncertainty: 'because-reasons' },
      ),
    ).toThrow(/unknown uncertainty/);
    for (const reason of UNCERTAINTY_REASONS) expect(typeof reason).toBe('string');
  });

  it('cannot report completeness as true, by construction', () => {
    const ledger = createLedger();
    record(
      ledger,
      makeFact(
        'DbEffect',
        'e1',
        { access: 'read' },
        { file: 'a.js', contract: 'mongo/driver' },
      ),
    );
    // A ledger with facts and no recorded stop is UNPROVEN, not complete.
    expect(summarizeLedger(ledger).complete).toBeNull();
    record(
      ledger,
      makeFact(
        'UnknownBoundary',
        'u1',
        {},
        { file: 'a.js', contract: 'node/resolve', uncertainty: 'depth-budget' },
      ),
    );
    expect(summarizeLedger(ledger).complete).toBe(false);
  });

  it('keeps every fact kind and every contract accounted for', () => {
    expect(FACT_KINDS).toEqual([
      'AsyncContinuation',
      // TAPP-1's seventh kind (ADR-100). Listed here on purpose: the header of
      // `facts.js` says no new kind without an ADR, and this assertion is what
      // makes adding one a deliberate act rather than a diff nobody noticed.
      'DataFlowPath',
      'DataSource',
      'DbEffect',
      'DbEffectOccurrence',
      'GuardBoundary',
      // Nest static direct provider V1's eighth kind (ADR-102). Listed here so
      // adding one stays a deliberate act rather than a diff nobody noticed.
      'ProviderLinkage',
      'UnknownBoundary',
    ]);
    // A contract that is not modelled must stay DECLARED, so the gap is
    // countable rather than invisible.
    expect(CONTRACTS.some((c) => !c.modelled)).toBe(true);
    for (const contract of CONTRACTS) expect(typeof contract.note).toBe('string');
  });

  it('models the legacy Mongo driver verbs the modern tables omit', () => {
    // NodeGoat's entire write path is `collection.update(...)`: a table that
    // only knew updateOne/updateMany read that application as write-free.
    expect(MONGO_COLLECTION_OPS.update).toBe('update');
    expect(MONGO_COLLECTION_OPS.insert).toBe('insert');
    expect(MONGO_COLLECTION_OPS.remove).toBe('delete');
  });

  it('requires all four obligations before crediting a guard', () => {
    const all = {
      onRouteChain: true,
      denyPathProven: true,
      allowPathReachesHandler: true,
      mutationDominated: true,
    };
    expect(guardBoundaryProof(all).credited).toBe(true);
    for (const key of Object.keys(all)) {
      const proof = guardBoundaryProof({ ...all, [key]: false });
      expect(proof.credited).toBe(false);
      expect(proof.unmet).toContain(key);
    }
  });
});

describe('Node Semantic Kernel — lexical capture', () => {
  it('resolves an inner shadowing binding over an outer one', () => {
    const outer = {
      instances: new Map([['dao', { className: 'Outer' }]]),
      collections: new Map(),
    };
    const inner = {
      instances: new Map([['dao', { className: 'Inner' }]]),
      collections: new Map(),
    };
    // innermost first — the rule the language itself applies
    expect(captureChain([inner, outer]).instance('dao').className).toBe('Inner');
    expect(captureChain([outer]).instance('dao').className).toBe('Outer');
    expect(captureChain([]).instance('dao')).toBeNull();
  });

  it('collects nothing from a scope with no bindings', () => {
    expect(scopeBindings(null).instances.size).toBe(0);
    expect(scopeBindings(undefined).collections.size).toBe(0);
  });
});
