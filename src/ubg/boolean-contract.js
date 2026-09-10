// Finite Boolean syntax only. This module shares validation, never evaluation.
import { createHash } from 'node:crypto';

export function readBoolean(formula) {
  const atoms = new Set();
  let nodes = 0;
  function visit(value, depth) {
    if (++nodes > 256 || depth > 32) throw Error('formula-budget');
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:]{0,63}$/.test(value)) {
      atoms.add(value);
      if (atoms.size > 12) throw Error('atom-budget');
      return value;
    }
    if (!Array.isArray(value)) throw Error('unsupported-formula');
    const [op] = value;
    if (
      op === 'not'
        ? value.length !== 2
        : !['and', 'or'].includes(op) || value.length < 3 || value.length > 257
    )
      throw Error('unsupported-formula');
    return [op, ...value.slice(1).map((child) => visit(child, depth + 1))];
  }
  const tree = visit(formula, 0);
  return {
    tree,
    atoms: [...atoms].sort(),
    hash: createHash('sha256').update(JSON.stringify(tree)).digest('hex'),
  };
}
