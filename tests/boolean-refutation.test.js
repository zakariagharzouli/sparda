import { describe, it, expect, vi } from 'vitest';
import { readBoolean } from '../src/ubg/boolean-contract.js';
import * as solver from '../src/ubg/boolean-solver.js';
import { verifyBoolean } from '../src/ubg/boolean-checker.js';
import { checkAuthorizationLogic } from '../src/ubg/authorization-logic.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const { solveBoolean } = solver;
const graph = {
  meta: { sourceHash: 'a'.repeat(64) },
  nodes: [
    { id: 'entrypoint:GET /items', kind: 'entrypoint', label: 'GET /items', meta: {} },
  ],
  edges: [],
};
const model = {
  schema: 'sparda-authorization-model/v1',
  basis: 'Explicit test policy',
  sourceHash: graph.meta.sourceHash,
  entrypoint: graph.nodes[0].id,
  domain: true,
  path: 'authenticated',
  allowed: ['and', 'authenticated', 'admin'],
};

// The exhaustive oracle uses bit tables, not either implementation's tree walk.
function dnf(bits) {
  const terms = [];
  for (let row = 0; row < 4; row++)
    if (bits & (1 << row))
      terms.push(['and', row & 1 ? 'a' : ['not', 'a'], row & 2 ? 'b' : ['not', 'b']]);
  return terms.length === 0 ? false : terms.length === 1 ? terms[0] : ['or', ...terms];
}

describe('bounded Boolean refutation', () => {
  it('agrees with 512 deterministic four-atom nested formulas', () => {
    let seed = 739;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const atomMasks = [0xaaaa, 0xcccc, 0xf0f0, 0xff00];
    function generate(depth) {
      if (!depth) {
        const i = (random() >>> 28) & 3;
        return { formula: 'abcd'[i], mask: atomMasks[i] };
      }
      const op = (random() >>> 28) & 3,
        a = generate(depth - 1);
      if (op === 0) return { formula: ['not', a.formula], mask: ~a.mask & 0xffff };
      const b = generate(depth - 1);
      return {
        formula: [op === 1 ? 'and' : 'or', a.formula, b.formula],
        mask: op === 1 ? a.mask & b.mask : a.mask | b.mask,
      };
    }
    for (let i = 0; i < 512; i++) {
      const { formula, mask } = generate(4),
        result = solveBoolean(formula);
      expect(result.status).toBe(mask ? 'SAT' : 'UNSAT');
      expect(verifyBoolean(formula, result.certificate)).toBe(true);
    }
  });
  it('agrees with all 4096 two-atom domain/path/policy truth-table combinations', () => {
    for (let domain = 0; domain < 16; domain++)
      for (let path = 0; path < 16; path++)
        for (let allowed = 0; allowed < 16; allowed++) {
          const formula = ['and', dnf(domain), dnf(path), ['not', dnf(allowed)]];
          const expected = (domain & path & ~allowed & 15) !== 0;
          const result = solveBoolean(formula);
          expect(result.status).toBe(expected ? 'SAT' : 'UNSAT');
          expect(verifyBoolean(formula, result.certificate)).toBe(true);
        }
  });
  it('emits deterministic certificates and handles true/false with no atoms', () => {
    for (const formula of [
      true,
      false,
      ['or', 'owner', 'admin'],
      ['and', 'a', ['not', 'a']],
    ]) {
      expect(solveBoolean(formula)).toEqual(solveBoolean(formula));
      expect(verifyBoolean(formula, solveBoolean(formula).certificate)).toBe(true);
    }
  });
  it('retains domain relations between ABAC predicates', () => {
    const result = checkAuthorizationLogic(graph, {
      ...model,
      domain: ['or', ['not', 'owner'], 'member'],
      path: 'owner',
      allowed: 'member',
    });
    expect(result.modelSatisfiable).toBe(false);
    expect(result.authorizationViolation).toBeNull();
    expect(
      checkAuthorizationLogic(graph, { ...model, path: 'owner', allowed: 'member' })
        .modelSatisfiable,
    ).toBe(true);
  });
  it.each([
    null,
    {},
    { unknown: true },
    ['xor', 'a', 'b'],
    ['not'],
    ['not', 'a', 'b'],
    ['and', 'a'],
    ['or'],
    1,
    '',
  ])('declines unsupported syntax %j', (formula) => {
    expect(solveBoolean(formula)).toMatchObject({ status: 'UNKNOWN', certificate: null });
    expect(verifyBoolean(formula, {})).toBe(false);
  });
  it('bounds depth, atoms and formula size', () => {
    let deep = 'a';
    for (let i = 0; i < 34; i++) deep = ['not', deep];
    const wide = ['and', ...Array.from({ length: 256 }, () => true)];
    const atoms = ['and', ...Array.from({ length: 13 }, (_, i) => 'a' + i)];
    for (const formula of [deep, wide, atoms])
      expect(solveBoolean(formula).status).toBe('UNKNOWN');
  });
  it('bounds cycles without throwing to the caller', () => {
    const cyclic = ['not'];
    cyclic.push(cyclic);
    expect(solveBoolean(cyclic).status).toBe('UNKNOWN');
  });
  it('does not label an exhausted search UNSAT', () => {
    expect(solveBoolean('a', { maxSteps: 1 })).toMatchObject({
      status: 'UNKNOWN',
      certificate: null,
    });
    for (const maxSteps of [0, -1, 1.5, Infinity, 100001])
      expect(solveBoolean(true, { maxSteps }).status).toBe('UNKNOWN');
  });
});

describe('independent certificate rejection', () => {
  it('rejects a forged SAT assignment and an incomplete witness', () => {
    const certificate = solveBoolean('admin').certificate;
    expect(verifyBoolean('admin', { ...certificate, assignment: [false] })).toBe(false);
    for (const assignment of [[], [true, false], [1], new Array(1)])
      expect(verifyBoolean('admin', { ...certificate, assignment })).toBe(false);
  });
  it('binds the certificate to its original formula and schema', () => {
    const certificate = solveBoolean('a').certificate;
    expect(verifyBoolean('b', certificate)).toBe(false);
    expect(verifyBoolean('a', { ...certificate, schema: 'anything' })).toBe(false);
    expect(verifyBoolean('a', { ...certificate, status: 'UNKNOWN' })).toBe(false);
  });
  it('requires both branches and a contradiction at every leaf', () => {
    const formula = ['and', 'a', ['not', 'a']],
      certificate = solveBoolean(formula).certificate;
    expect(certificate.tree).toEqual(['a', null, null]);
    expect(verifyBoolean(formula, { ...certificate, tree: null })).toBe(false);
    expect(verifyBoolean(formula, { ...certificate, tree: ['a', null] })).toBe(false);
    expect(
      verifyBoolean(formula, { ...certificate, tree: ['a', null, ['a', null, null]] }),
    ).toBe(false);
    expect(
      verifyBoolean(formula, { ...certificate, tree: ['foreign', null, null] }),
    ).toBe(false);
    const satisfiable = ['or', 'a', false];
    const forged = { ...certificate, formulaHash: readBoolean(satisfiable).hash };
    expect(verifyBoolean(satisfiable, forged)).toBe(false);
    // A false branch alone cannot discharge the true branch.
    expect(
      verifyBoolean('a', { ...certificate, formulaHash: readBoolean('a').hash }),
    ).toBe(false);
    const missing = { ...certificate };
    delete missing.tree;
    expect(verifyBoolean(formula, missing)).toBe(false);
  });
  it('does not reinterpret a cyclic proof as a certificate', () => {
    const tree = ['a', null];
    tree.push(tree);
    expect(
      verifyBoolean(['and', 'a', ['not', 'a']], {
        ...solveBoolean(['and', 'a', ['not', 'a']]).certificate,
        tree,
      }),
    ).toBe(false);
  });
});

describe('opt-in checkGraph authorization model', () => {
  it('rejects a solver headline that disagrees with its valid certificate', () => {
    const formula = ['and', model.domain, model.path, ['not', model.allowed]];
    const bad = { ...solveBoolean(formula), status: 'UNSAT' };
    const spy = vi.spyOn(solver, 'solveBoolean').mockReturnValue(bad);
    try {
      expect(checkAuthorizationLogic(graph, model)).toMatchObject({
        status: 'UNKNOWN',
        reason: 'certificate-rejected',
        modelSatisfiable: null,
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('checks a Boolean counterexample without upgrading findings or runtime claims', () => {
    const baseline = checkGraph(graph),
      report = checkGraph(graph, { authorizationModel: model });
    expect(report.authorizationLogic).toMatchObject({
      status: 'SAT',
      modelSatisfiable: true,
      certificateVerified: true,
      authorizationViolation: null,
      productionEligible: false,
    });
    const { authorizationLogic: _logic, ...ordinary } = report;
    expect(ordinary).toEqual(baseline);
    expect(baseline).not.toHaveProperty('authorizationLogic');
    expect(report.authorizationLogic.assumptions).toContain(
      'model-to-code-link-unverified',
    );
  });
  it('reports only model UNSAT even with an impossible path', () => {
    const result = checkAuthorizationLogic(graph, { ...model, path: false });
    expect(result).toMatchObject({
      status: 'UNSAT',
      modelSatisfiable: false,
      certificateVerified: true,
      authorizationViolation: null,
      productionEligible: false,
    });
  });
  it.each([
    null,
    {},
    { ...model, basis: '' },
    { ...model, sourceHash: 'b'.repeat(64) },
    { ...model, entrypoint: 'entrypoint:GET /missing' },
    { ...model, allowed: { unknown: true } },
    { ...model, domain: undefined },
  ])('keeps unavailable evidence inside the headline: %j', (input) => {
    expect(
      checkGraph(graph, { authorizationModel: input }).authorizationLogic,
    ).toMatchObject({
      status: 'UNKNOWN',
      modelSatisfiable: null,
      certificateVerified: null,
      authorizationViolation: null,
    });
  });
  it('binds a model to its policy, route and source context', () => {
    const a = checkAuthorizationLogic(graph, model);
    const b = checkAuthorizationLogic(graph, {
      ...model,
      basis: 'Another explicit policy',
    });
    expect(a.modelHash).not.toBe(b.modelHash);
    expect(a.sourceHash).toBe(graph.meta.sourceHash);
  });
  it('declines the claim if the solver supplies a forged certificate', () => {
    const bad = solveBoolean(false);
    bad.certificate = { ...bad.certificate, status: 'SAT', assignment: [] };
    bad.status = 'SAT';
    const spy = vi.spyOn(solver, 'solveBoolean').mockReturnValue(bad);
    try {
      expect(checkAuthorizationLogic(graph, model)).toMatchObject({
        status: 'UNKNOWN',
        reason: 'certificate-rejected',
        modelSatisfiable: null,
      });
    } finally {
      spy.mockRestore();
    }
  });
});
