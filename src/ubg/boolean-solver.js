import { readBoolean } from './boolean-contract.js';

// Deterministic Shannon expansion with a work counter, no clock or external solver.
export function solveBoolean(formula, { maxSteps = 100000 } = {}) {
  let steps = 0;
  try {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 100000)
      throw Error('invalid-budget');
    const { tree, atoms, hash } = readBoolean(formula),
      values = new Map();
    function evaluate(node) {
      if (++steps > maxSteps) throw Error('search-budget');
      if (typeof node === 'boolean') return node;
      if (typeof node === 'string') return values.get(node) ?? null;
      if (node[0] === 'not') {
        const value = evaluate(node[1]);
        return value === null ? null : !value;
      }
      const neutral = node[0] === 'and';
      let unknown = false;
      for (const child of node.slice(1)) {
        const value = evaluate(child);
        if (value === !neutral) return !neutral;
        unknown ||= value === null;
      }
      return unknown ? null : neutral;
    }
    function search(index) {
      const value = evaluate(tree);
      if (value === false) return { tree: null };
      if (value === true) return { assignment: atoms.map((a) => values.get(a) ?? false) };
      if (index >= atoms.length) throw Error('incomplete-evaluation');
      const atom = atoms[index];
      values.set(atom, false);
      const left = search(index + 1);
      if (left.assignment) return left;
      values.set(atom, true);
      const right = search(index + 1);
      values.delete(atom);
      if (right.assignment) return right;
      return { tree: [atom, left.tree, right.tree] };
    }
    const result = search(0);
    const status = result.assignment ? 'SAT' : 'UNSAT';
    return {
      status,
      steps,
      certificate: {
        schema: 'sparda-boolean-certificate/v1',
        formulaHash: hash,
        status,
        ...result,
      },
    };
  } catch (error) {
    return { status: 'UNKNOWN', reason: error.message, steps, certificate: null };
  }
}
