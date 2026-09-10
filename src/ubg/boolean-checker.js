import { readBoolean } from './boolean-contract.js';

// Independent certificate evaluator. Masks: 1=false, 2=true, 3=unassigned.
// It imports neither the solver nor its search/evaluation functions.
export function verifyBoolean(formula, certificate) {
  try {
    const { tree, atoms, hash } = readBoolean(formula);
    if (
      certificate?.schema !== 'sparda-boolean-certificate/v1' ||
      certificate.formulaHash !== hash
    )
      return false;
    let work = 0,
      proofNodes = 0;
    const values = new Map();
    function mask(node) {
      if (++work > 1000000) throw Error('checker-budget');
      if (typeof node === 'boolean') return node ? 2 : 1;
      if (typeof node === 'string')
        return values.has(node) ? (values.get(node) ? 2 : 1) : 3;
      if (node[0] === 'not') {
        const m = mask(node[1]);
        return ((m & 1) << 1) | ((m & 2) >> 1);
      }
      const children = node.slice(1).map(mask);
      if (node[0] === 'and')
        return children.includes(1) ? 1 : children.every((m) => m === 2) ? 2 : 3;
      return children.includes(2) ? 2 : children.every((m) => m === 1) ? 1 : 3;
    }
    if (certificate.status === 'SAT') {
      const assignment = certificate.assignment;
      if (
        !Array.isArray(assignment) ||
        assignment.length !== atoms.length ||
        !Array.from(assignment).every((v) => typeof v === 'boolean')
      )
        return false;
      atoms.forEach((atom, i) => values.set(atom, assignment[i]));
      return mask(tree) === 2;
    }
    if (certificate.status !== 'UNSAT' || !Object.hasOwn(certificate, 'tree'))
      return false;
    function check(proof, depth) {
      if (++proofNodes > 8191 || depth > atoms.length) return false;
      if (proof === null) return mask(tree) === 1;
      if (
        !Array.isArray(proof) ||
        proof.length !== 3 ||
        !atoms.includes(proof[0]) ||
        values.has(proof[0])
      )
        return false;
      values.set(proof[0], false);
      if (!check(proof[1], depth + 1)) return false;
      values.set(proof[0], true);
      if (!check(proof[2], depth + 1)) return false;
      values.delete(proof[0]);
      return true;
    }
    return check(certificate.tree, 0);
  } catch {
    return false;
  }
}
