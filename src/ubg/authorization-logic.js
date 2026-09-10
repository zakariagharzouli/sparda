import { createHash } from 'node:crypto';
import { readBoolean } from './boolean-contract.js';
import { solveBoolean } from './boolean-solver.js';
import { verifyBoolean } from './boolean-checker.js';

// A caller-supplied finite model is not an extracted, executable application path.
// No result from this experiment can upgrade the existing security verdict.
export function checkAuthorizationLogic(graph, model) {
  const unknown = (reason) => ({
    schema: 'sparda-authorization-logic/v1',
    status: 'UNKNOWN',
    reason,
    modelSatisfiable: null,
    certificateVerified: null,
    authorizationViolation: null,
    sourceHash: graph?.meta?.sourceHash ?? null,
    modelHash: null,
    certificate: null,
    productionEligible: false,
  });
  try {
    if (
      !model ||
      model.schema !== 'sparda-authorization-model/v1' ||
      typeof model.basis !== 'string' ||
      !model.basis.trim() ||
      model.basis.length > 500
    )
      return unknown('explicit-model-required');
    if (
      !/^[a-f0-9]{64}$/.test(model.sourceHash ?? '') ||
      model.sourceHash !== graph?.meta?.sourceHash
    )
      return unknown('source-mismatch');
    if (!graph?.nodes?.some((n) => n.kind === 'entrypoint' && n.id === model.entrypoint))
      return unknown('route-unmeasured');
    // The supplied domain must encode relationships between ABAC predicates.
    const formula = ['and', model.domain, model.path, ['not', model.allowed]];
    const normalized = readBoolean(formula);
    const result = solveBoolean(normalized.tree);
    if (result.status === 'UNKNOWN') return unknown(result.reason);
    if (
      result.status !== result.certificate?.status ||
      !verifyBoolean(normalized.tree, result.certificate)
    )
      return unknown('certificate-rejected');
    const envelope = {
      sourceHash: model.sourceHash,
      entrypoint: model.entrypoint,
      basis: model.basis,
      formula: normalized.tree,
    };
    return {
      ...unknown(null),
      status: result.status,
      modelSatisfiable: result.status === 'SAT',
      certificateVerified: true,
      modelHash: createHash('sha256').update(JSON.stringify(envelope)).digest('hex'),
      certificate: result.certificate,
      assumptions: [
        'caller-supplied-policy-path-and-domain',
        'model-to-code-link-unverified',
      ],
    };
  } catch {
    return unknown('invalid-model');
  }
}
