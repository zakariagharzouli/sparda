// Explicit policy checks over an existing compilation. A policy is an input,
// not a fact inferred from a route name or a benchmark label. These checks never
// certify runtime access control and never alter the automatic security verdict.
import { createHash } from 'node:crypto';
import { stableStringify } from './schema.js';

const hash = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 500;
const exactKeys = (value, keys) =>
  object(value) && Object.keys(value).every((k) => keys.includes(k));
const surfaces = new Set(['body', 'params', 'query']);
const validFile = (value) =>
  string(value) &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !value.includes(':') &&
  value.split('/').every((p) => p !== '.' && p !== '..' && p.length);

function validate(policy) {
  if (
    !exactKeys(policy, ['schema', 'id', 'basis', 'sourceHash', 'requirements']) ||
    policy.schema !== 'sparda-authorization-policy/v1' ||
    !string(policy.id) ||
    !string(policy.basis) ||
    !/^[a-f0-9]{64}$/.test(policy.sourceHash ?? '') ||
    !Array.isArray(policy.requirements) ||
    policy.requirements.length === 0 ||
    policy.requirements.length > 128
  )
    return false;
  const ids = new Set();
  for (const rule of policy.requirements) {
    if (
      !exactKeys(rule, [
        'id',
        'entrypoint',
        'kind',
        'source',
        'table',
        'access',
        'middleware',
      ]) ||
      !string(rule.id) ||
      ids.has(rule.id) ||
      !/^entrypoint:[A-Z]+ \/[^\r\n]*$/.test(rule.entrypoint ?? '')
    )
      return false;
    ids.add(rule.id);
    if (rule.kind === 'forbid-client-filter') {
      if (
        'middleware' in rule ||
        !string(rule.table) ||
        !['read', 'write'].includes(rule.access) ||
        !exactKeys(rule.source, ['origin', 'name']) ||
        !surfaces.has(rule.source.origin) ||
        !string(rule.source.name)
      )
        return false;
    } else if (rule.kind === 'require-route-middleware') {
      if (
        'source' in rule ||
        'table' in rule ||
        'access' in rule ||
        !exactKeys(rule.middleware, ['file', 'line', 'symbol']) ||
        !validFile(rule.middleware.file) ||
        !string(rule.middleware.symbol) ||
        !Number.isSafeInteger(rule.middleware.line) ||
        rule.middleware.line < 1
      )
        return false;
    } else return false;
  }
  return true;
}

export function checkAuthorizationPolicy(graph, report, policy) {
  const unknown = (reason) => ({
    schema: 'sparda-authorization-check/v1',
    status: 'unknown',
    reason,
    policyHash: null,
    sourceHash: graph?.meta?.sourceHash ?? null,
    checks: [],
    violations: null,
    satisfied: null,
    runtimeViolation: null,
    automaticDetection: false,
  });
  let policyBytes;
  try {
    policyBytes = Buffer.byteLength(stableStringify(policy));
  } catch {
    return unknown('invalid-policy');
  }
  if (policyBytes > 65536) return unknown('policy-byte-budget');
  if (!validate(policy)) return unknown('invalid-policy');
  if (graph?.meta?.sourceHash !== policy.sourceHash)
    return unknown('policy-source-mismatch');
  const facts = report?.kernel?.facts;
  if (!Array.isArray(facts) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return unknown('missing-compilation-evidence');
  if (facts.length > 200000 || graph.nodes.length > 100000 || graph.edges.length > 200000)
    return unknown('evidence-budget');
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const checks = policy.requirements.map((rule) => {
    const base = {
      id: rule.id,
      entrypoint: rule.entrypoint,
      kind: rule.kind,
      state: 'unknown',
      reason: null,
      evidence: [],
      runtimeViolation: null,
    };
    if (nodes.get(rule.entrypoint)?.kind !== 'entrypoint')
      return { ...base, reason: 'route-unmeasured' };
    if (rule.kind === 'forbid-client-filter') {
      const occurrences = facts.filter(
        (f) =>
          f.kind === 'DbEffectOccurrence' &&
          f.entrypoint === rule.entrypoint &&
          f.table === rule.table &&
          f.access === rule.access &&
          !f.symbolicTarget &&
          nodes.get(f.effect)?.kind === 'effect',
      );
      const hits = occurrences.filter((f) =>
        f.filterOrigins?.some(
          (o) => o.origin === rule.source.origin && o.name === rule.source.name,
        ),
      );
      if (hits.length)
        return {
          ...base,
          state: 'violated',
          reason: 'forbidden-origin-in-modelled-filter',
          evidence: hits
            .map((f) => ({
              occurrence: f.id,
              effect: f.effect,
              source: rule.source,
              provenance: f.provenance,
            }))
            .sort((a, b) => a.occurrence.localeCompare(b.occurrence, 'en')),
        };
      // No hit is not a proof of absence: an opaque helper may still read this source.
      return { ...base, reason: 'absence-of-origin-not-proven' };
    }
    const chain = graph.edges.filter(
      (e) => e.kind === 'control_flow' && e.meta?.route === rule.entrypoint,
    );
    const targets = new Set(chain.map((e) => e.to));
    if (
      !chain.length ||
      chain.some((e) => !nodes.has(e.to) || nodes.get(e.to).meta?.opaque)
    )
      return { ...base, reason: 'route-chain-unmeasured' };
    const registered = [...targets]
      .map((id) => nodes.get(id))
      .filter((n) => ['guard', 'logic'].includes(n.kind));
    const exact = registered.filter(
      (n) =>
        n.loc?.file === rule.middleware.file &&
        n.loc?.line === rule.middleware.line &&
        n.label === rule.middleware.symbol,
    );
    // Only registration is checked. A registered no-op is NOT a proven role guard.
    return {
      ...base,
      state: exact.length ? 'satisfied' : 'violated',
      reason: exact.length
        ? 'required-middleware-registered'
        : 'required-middleware-not-in-compiled-chain',
      evidence: [
        {
          required: rule.middleware,
          observed: registered.map((n) => ({
            id: n.id,
            file: n.loc?.file,
            line: n.loc?.line,
            symbol: n.label,
          })),
        },
      ],
    };
  });
  return {
    schema: 'sparda-authorization-check/v1',
    status: checks.some((c) => c.state === 'violated')
      ? 'violated'
      : checks.some((c) => c.state === 'unknown')
        ? 'unknown'
        : 'satisfied',
    policyId: policy.id,
    basis: policy.basis,
    policyHash: hash(policy),
    sourceHash: graph.meta.sourceHash,
    evidenceHash: hash({ graph, facts }),
    checks,
    violations: checks.some((c) => c.state === 'unknown')
      ? null
      : checks.filter((c) => c.state === 'violated').length,
    satisfied: checks.some((c) => c.state === 'unknown')
      ? null
      : checks.filter((c) => c.state === 'satisfied').length,
    runtimeViolation: null,
    automaticDetection: false,
  };
}
