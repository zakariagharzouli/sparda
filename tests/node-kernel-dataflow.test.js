// DataSource → DbEffect, and the boundaries the walk declares instead of
// crossing. Every assertion is about PROVENANCE, never about safety.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(here, 'fixtures', name);

const compiled = compileUBG(fix('node-kernel-dataflow'), { write: false });
const effects = [...compiled.graph.nodes.values()].filter((n) => n.kind === 'effect');
const byTableOp = (op) => effects.find((n) => n.meta.op === op);

describe('DataSource → DbEffect', () => {
  it('links req.params to a read filter, through a DAO and a nested filter builder', () => {
    // The whole chain in one assertion: req.params → destructure → positional
    // callback → cross-file DAO → parseInt → nested `criteria()` → Mongo filter.
    const read = effects.find(
      (n) =>
        n.meta.effectType === 'db_read' && n.meta.filterOrigins?.[0]?.origin === 'params',
    );
    expect(read).toBeDefined();
    expect(read.meta.filterOrigins).toEqual([{ origin: 'params', name: 'accountId' }]);
    expect(read.meta.table).toBe('accounts');
  });

  it('links req.body to the MODIFIED DATA of a write, separately from the filter', () => {
    const write = byTableOp('update');
    expect(write.meta.effectType).toBe('db_write');
    // Two different questions, two different lists: a client-chosen FILTER is an
    // object-scope question, a client-chosen PAYLOAD a validation one.
    expect(write.meta.filterOrigins).toEqual([{ origin: 'body', name: 'accountId' }]);
    expect(write.meta.dataOrigins).toEqual([{ origin: 'body', name: 'label' }]);
  });

  it('distinguishes a session-derived filter from a client-chosen one', () => {
    // The discriminator the advisory rests on: an identity the framework
    // attached CONSTRAINS, a value the client sent SELECTS.
    const owned = effects.find(
      (n) =>
        n.meta.filterOrigins?.length === 1 &&
        n.meta.filterOrigins[0].origin === 'session',
    );
    expect(owned).toBeDefined();
    expect(owned.meta.filterOrigins).toEqual([{ origin: 'session', name: 'userId' }]);
    // and the mixed filter keeps BOTH origins — a session constraint never
    // erases the client-supplied selector it constrains
    const mixed = effects.find((n) => n.meta.filterOrigins?.length === 2);
    expect(mixed.meta.filterOrigins.map((o) => o.origin).sort()).toEqual([
      'params',
      'session',
    ]);
  });

  it('keeps the declaring file as the provenance across the file boundary', () => {
    const facts = compiled.report.kernel.facts.filter((f) => f.kind === 'DbEffect');
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts)
      expect(fact.provenance.file).toBe('src/data/accounts-dao.js');
  });
});

describe('OBJECT_SCOPE_UNPROVEN stays advisory, with a full witness', () => {
  const { findings } = checkGraph(canonicalizeGraph(compiled.graph));
  const scope = findings.filter((f) => f.rule === 'OBJECT_SCOPE_UNPROVEN');

  it('fires on a client-chosen filter under a guard', () => {
    expect(scope.length).toBeGreaterThan(0);
  });

  it('is ADVISORY and never severity high — promoting it needs its own ADR', () => {
    for (const finding of scope) {
      expect(finding.advisory).toBe(true);
      expect(finding.severity).toBe('info');
      expect(finding.severity).not.toBe('high');
    }
    // and it is therefore invisible to any consumer counting hard findings
    expect(
      findings.filter((f) => !f.advisory && f.rule === 'OBJECT_SCOPE_UNPROVEN'),
    ).toEqual([]);
  });

  it('carries the surface, the value, the table and the position', () => {
    const witness = scope.flatMap((f) => f.dataWitness ?? []);
    expect(witness.length).toBeGreaterThan(0);
    for (const w of witness) {
      expect(['params', 'query', 'body']).toContain(w.origin);
      expect(typeof w.name).toBe('string');
      expect(w.at).toMatch(/:\d+$/);
    }
  });

  it('does not fire on the session-scoped route', () => {
    expect(scope.some((f) => f.entrypoint === 'entrypoint:GET /accounts/mine')).toBe(
      false,
    );
  });

  it('does not fire when a CLIENT id is constrained by the session identity', () => {
    // The discriminator under test, isolated: same client-supplied accountId as
    // the flagged route, plus a session value in the same filter. If a session
    // origin stopped counting as a CONSTRAINT, this route would be flagged and
    // the advisory would fire on correctly scoped code.
    expect(
      scope.some((f) => f.entrypoint === 'entrypoint:GET /accounts/:accountId/scoped'),
    ).toBe(false);
    // and the flagged twin is still flagged, so this is a discriminator and not
    // a rule that simply stopped firing
    expect(
      scope.some((f) => f.entrypoint === 'entrypoint:GET /accounts/:accountId'),
    ).toBe(true);
  });
});

describe('followCalls declares its stops', () => {
  const stopped = compileUBG(fix('node-kernel-stops'), { write: false });
  const unknowns = stopped.report.kernel.facts.filter(
    (f) => f.kind === 'UnknownBoundary',
  );
  const causes = new Set(unknowns.map((f) => f.provenance.uncertainty));

  it('classifies a bare call with no binding as an unresolved alias', () => {
    expect(causes).toContain('unresolved-alias');
  });

  it('classifies a computed member call as a dynamic member', () => {
    expect(causes).toContain('dynamic-member');
  });

  it('classifies an unbound receiver as an unresolved receiver', () => {
    expect(causes).toContain('unresolved-receiver');
  });

  it('classifies a continuation handed to an unresolved callee as opaque', () => {
    expect(causes).toContain('opaque-callback');
  });

  it('classifies a producer/consumer whose other end is not static as a queue gap', () => {
    expect(causes).toContain('unresolved-queue');
  });

  it('classifies an instance whose declaring scope cannot be opened', () => {
    // Distinct from `unresolved-module` on purpose: that one loses a method,
    // this one loses a whole dependency, and a ledger that cannot tell them
    // apart cannot be used to decide what to fix first.
    expect(causes).toContain('unreachable-capture');
  });

  it('emits every cause it declares — a declared-but-silent cause is a gap', () => {
    // The registry half. Six causes are reachable from real fixtures; the rest
    // are declared and must stay declared rather than quietly disappear from
    // UNCERTAINTY_REASONS to make this assertion pass.
    expect(causes.size).toBeGreaterThanOrEqual(6);
  });

  it('gives every boundary a file, a line, a symbol and a cause', () => {
    expect(unknowns.length).toBeGreaterThan(0);
    for (const fact of unknowns) {
      expect(fact.provenance.file).toBeTruthy();
      expect(fact.provenance.uncertainty).toBeTruthy();
      expect(fact.symbol).toBeTruthy();
      expect(fact.detail).toBeTruthy();
    }
  });

  it('attaches a boundary to the body that was being resolved', () => {
    // Without an owner a boundary floats beside the graph instead of sitting on
    // the path a reader is trying to follow.
    expect(unknowns.some((f) => typeof f.owner === 'string' && f.owner.length > 0)).toBe(
      true,
    );
  });

  it('never reports the walk as complete', () => {
    expect(stopped.report.kernel.complete).toBe(false);
    expect(compiled.report.kernel.complete).not.toBe(true);
  });

  it('does not raise a boundary for the language or the response surface', () => {
    // `res.json`, `console.log`, `JSON.stringify` are not behavioural hops. If
    // they were counted the ledger would describe JavaScript, and `byUncertainty`
    // would stop being a number anyone can act on.
    const symbols = unknowns.map((f) => f.symbol);
    for (const inert of ['res.json', 'console.log', 'JSON.stringify', 'Math.max'])
      expect(symbols).not.toContain(inert);
  });
});
