import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readBoolean } from './boolean-contract.js';
import { checkAuthorizationLogic } from './authorization-logic.js';
import { sourceHashOf } from './serialize.js';

const script = fileURLToPath(new URL('./python_admission.py', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const unknown = (reason, extra = {}) => ({
  status: 'UNKNOWN',
  reason,
  modelSatisfiable: null,
  conditionExtracted: null,
  authorizationViolation: null,
  productionEligible: false,
  ...extra,
});

export function checkPythonAuthorization(
  cwd,
  graph,
  extracted,
  policy,
  compilationFiles,
  pythonCmd = 'python',
) {
  const checks = Array.from(policy.rules, (rule) => {
    const base = { entrypoint: rule?.entrypoint ?? null };
    try {
      if (
        typeof rule?.entrypoint !== 'string' ||
        rule.entrypoint.length > 512 ||
        Object.keys(rule).some((k) => !['entrypoint', 'allowed'].includes(k))
      )
        return unknown('invalid-rule', base);
      const allowed = readBoolean(rule.allowed);
      if (allowed.atoms.some((a) => !/^state\.[A-Za-z][A-Za-z0-9_]{0,39}$/.test(a)))
        return unknown('unsupported-policy-predicate', base);
      const routes = extracted.routes.filter(
        (r) => `entrypoint:${r.method.toUpperCase()} ${r.path}` === rule.entrypoint,
      );
      if (routes.length !== 1) return unknown('ambiguous-or-missing-route', base);
      const route = routes[0];
      if (
        route.conditional ||
        extracted.unknownHandlers?.length ||
        extracted.skipped?.length ||
        extracted.globalMiddlewares.length
      )
        return unknown('registration-unmeasured', base);
      const root = fs.realpathSync(cwd),
        file = route.sourceFile,
        abs = fs.realpathSync(path.resolve(cwd, file)),
        rel = path.relative(root, abs);
      if (
        rel === '..' ||
        rel.startsWith('..' + path.sep) ||
        path.isAbsolute(rel) ||
        !extracted.scannedFiles.includes(file)
      )
        return unknown('unscanned-or-outside-source', base);
      if (
        fs.existsSync(path.join(root, 'fastapi.py')) ||
        fs.existsSync(path.join(root, 'fastapi'))
      )
        return unknown('framework-shadowed', base);
      if (fs.statSync(abs).size > 1048576) return unknown('source-byte-budget', base);
      const bytes = fs.readFileSync(abs),
        source = bytes.toString('utf8');
      const result = spawnSync(
        pythonCmd,
        pythonCmd === 'py' ? ['-3', script] : [script],
        {
          input: JSON.stringify({ source, entrypoint: rule.entrypoint }),
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 1048576,
        },
      );
      if (result.status !== 0) return unknown('python-admission-unavailable', base);
      const projection = JSON.parse(result.stdout);
      if (projection.status !== 'EXTRACTED')
        return unknown(projection.reason ?? 'python-admission-unmeasured', base);
      if (projection.sourceSha256 !== hash(bytes))
        return unknown('source-mismatch', base);
      const expected = [...projection.route.roots, projection.route.name];
      const edges = graph.edges
        .filter((e) => e.kind === 'control_flow' && e.meta?.route === rule.entrypoint)
        .sort((a, b) => a.meta.order - b.meta.order);
      if (expected.length !== route.chain.length || edges.length !== expected.length)
        return unknown('chain-projection-mismatch', base);
      for (const [i, step] of route.chain.entries()) {
        const edge = edges[i],
          node = graph.nodes.find((n) => n.id === edge.to);
        const line =
          i === expected.length - 1
            ? projection.route.line
            : projection.conditions.find((c) => c.name === expected[i])?.line;
        if (
          step.name !== expected[i] ||
          step.sourceFile !== file ||
          step.sourceLine !== line ||
          step.role !== (i === expected.length - 1 ? 'handler' : 'middleware') ||
          step.conditional ||
          edge.meta.order !== i ||
          edge.from !== (i === 0 ? rule.entrypoint : edges[i - 1].to) ||
          node?.meta?.opaque ||
          node?.loc?.file !== file ||
          node?.loc?.line !== line
        )
          return unknown('chain-projection-mismatch', base);
      }
      const conditions = projection.conditions.map((c) => ({
        ...c,
        formula: readBoolean(c.formula).tree,
        file,
        sourceSha256: hash(bytes),
        bodySha256: hash(bytes.subarray(c.startByte, c.endByte)),
      }));
      const formulas = conditions.map((c) => c.formula),
        pathFormula =
          formulas.length === 0
            ? true
            : formulas.length === 1
              ? formulas[0]
              : ['and', ...formulas];
      const checked = checkAuthorizationLogic(graph, {
        schema: 'sparda-authorization-model/v1',
        basis: policy.basis,
        sourceHash: policy.sourceHash,
        entrypoint: rule.entrypoint,
        domain: true,
        path: pathFormula,
        allowed: allowed.tree,
      });
      return {
        ...checked,
        ...base,
        conditionExtracted: true,
        scope: 'handler-entry-only',
        path: pathFormula,
        conditions,
        policy: allowed.tree,
        assumptions: [
          'stable-boolean-request-state-fields',
          'ordinary-fastapi-request-and-dependency-semantics',
          'supplied-policy-is-authoritative',
          'terminal-handler-and-effect-feasibility-unmeasured',
        ],
      };
    } catch (error) {
      return unknown(error.message, base);
    }
  });
  if (sourceHashOf(cwd, compilationFiles) !== graph.meta.sourceHash)
    return unknown('source-snapshot-mismatch', { checks: [] });
  return {
    schema: 'sparda-source-authorization-check/v1',
    status: checks.some((c) => c.status === 'UNKNOWN') ? 'UNKNOWN' : 'MEASURED',
    modelSatisfiable: checks.some((c) => c.status === 'UNKNOWN')
      ? null
      : checks.some((c) => c.modelSatisfiable),
    conditionExtracted: checks.every((c) => c.conditionExtracted === true) ? true : null,
    authorizationViolation: null,
    productionEligible: false,
    checks,
    sourceHash: graph.meta.sourceHash,
    policyHash: hash(JSON.stringify(policy)),
    compilationFiles,
  };
}
