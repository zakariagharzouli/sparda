import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseExpression } from '@babel/parser';
import { admissionCondition } from './admission-condition.js';
import { readBoolean } from './boolean-contract.js';
import { checkAuthorizationLogic } from './authorization-logic.js';
import { sourceHashOf } from './serialize.js';
import { checkPythonAuthorization } from './python-authorization.js';

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

// Policy remains supplied explicitly. Only the path to the handler is extracted.
// No graph metadata or default security verdict is changed by this opt-in report.
export function checkSourceAuthorization(
  cwd,
  graph,
  extracted,
  policy,
  compilationFiles,
  pythonCmd = 'python',
) {
  try {
    if (
      policy?.schema !== 'sparda-source-authorization/v1' ||
      Object.keys(policy).some(
        (k) => !['schema', 'basis', 'sourceHash', 'rules'].includes(k),
      ) ||
      typeof policy.basis !== 'string' ||
      !policy.basis.trim() ||
      policy.basis.length > 500 ||
      !Array.isArray(policy.rules) ||
      !policy.rules.length ||
      policy.rules.length > 32
    )
      return unknown('explicit-policy-required', { checks: [] });
    if (
      !/^[a-f0-9]{64}$/.test(policy.sourceHash ?? '') ||
      policy.sourceHash !== graph.meta?.sourceHash
    )
      return unknown('source-mismatch', { checks: [] });
    if (!['express', 'fastapi'].includes(graph.meta?.framework))
      return unknown('unsupported-framework', { checks: [] });
    if (
      !Array.isArray(compilationFiles) ||
      compilationFiles.length > 20000 ||
      compilationFiles.some((f) => typeof f !== 'string') ||
      sourceHashOf(cwd, compilationFiles) !== graph.meta.sourceHash
    )
      return unknown('source-snapshot-mismatch', { checks: [] });
    if (graph.meta.framework === 'fastapi')
      return checkPythonAuthorization(
        cwd,
        graph,
        extracted,
        policy,
        compilationFiles,
        pythonCmd,
      );
    const files = new Map(),
      root = path.resolve(cwd);
    function provenance(step) {
      if (!step.fn || !extracted.scannedFiles.includes(step.sourceFile))
        throw Error('unscanned-body');
      const absolute = path.resolve(root, step.sourceFile),
        relative = path.relative(root, absolute);
      if (
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative)
      )
        throw Error('source-outside-root');
      const real = fs.realpathSync(absolute),
        realRelative = path.relative(fs.realpathSync(root), real);
      if (
        realRelative === '..' ||
        realRelative.startsWith('..' + path.sep) ||
        path.isAbsolute(realRelative)
      )
        throw Error('source-outside-root');
      if (!files.has(absolute)) {
        if (fs.statSync(absolute).size > 1048576) throw Error('source-byte-budget');
        const bytes = fs.readFileSync(absolute);
        files.set(absolute, { bytes, source: bytes.toString('utf8') });
      }
      const { source, bytes } = files.get(absolute),
        { start, end } = step.fn;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end > source.length
      )
        throw Error('invalid-source-span');
      const admission = admissionCondition(step.fn);
      if (admission.conditionExtracted !== true) throw Error(admission.reason);
      // Confirm that the bytes we hash still describe the admitted AST condition.
      const fragment = source.slice(start, end);
      const fresh = admissionCondition(
        parseExpression(fragment, { plugins: ['typescript'] }),
      );
      const relativeTraces = admission.traces.map((t) => ({
        atom: t.atom,
        start: t.start - start,
        end: t.end - start,
      }));
      const freshTraces = fresh.traces.map((t) => ({
        atom: t.atom,
        start: t.start,
        end: t.end,
      }));
      if (
        fresh.conditionExtracted !== true ||
        JSON.stringify(fresh.formula) !== JSON.stringify(admission.formula) ||
        JSON.stringify(relativeTraces) !== JSON.stringify(freshTraces) ||
        source.slice(0, start).split('\n').length !== step.fn.loc.start.line
      )
        throw Error('source-body-mismatch');
      return {
        ...admission,
        source: {
          file: step.sourceFile,
          line: step.fn.loc.start.line,
          byteStart: Buffer.byteLength(source.slice(0, start)),
          byteEnd: Buffer.byteLength(source.slice(0, end)),
          fileHash: hash(bytes),
          bodyHash: hash(fragment),
        },
      };
    }
    const checks = Array.from(policy.rules, (rule) => {
      try {
        const base = { entrypoint: rule?.entrypoint ?? null };
        if (
          typeof rule?.entrypoint !== 'string' ||
          rule.entrypoint.length > 512 ||
          Object.keys(rule).some((k) => !['entrypoint', 'allowed'].includes(k))
        )
          return unknown('invalid-rule', base);
        const allowed = readBoolean(rule.allowed);
        if (allowed.atoms.some((a) => !/^session\.[A-Za-z][A-Za-z0-9_]{0,40}$/.test(a)))
          return unknown('unsupported-policy-predicate', base);
        const routes = extracted.routes.filter(
          (r) => `entrypoint:${r.method.toUpperCase()} ${r.path}` === rule.entrypoint,
        );
        if (routes.length !== 1) return unknown('ambiguous-or-missing-route', base);
        const route = routes[0];
        if (
          route.conditional ||
          extracted.unknownHandlers?.length ||
          extracted.skipped?.length
        )
          return unknown('registration-unmeasured', base);
        // Initial admission excludes global/mounted middleware: their applicability
        // and registration ordering need a separate certificate, not a guess.
        if (extracted.globalMiddlewares.length)
          return unknown('global-middleware-unmeasured', base);
        if (
          route.chain.length < 1 ||
          route.chain.length > 9 ||
          route.chain.at(-1).role !== 'handler'
        )
          return unknown('unsupported-chain', base);
        const edges = graph.edges
          .filter((e) => e.kind === 'control_flow' && e.meta?.route === rule.entrypoint)
          .sort((a, b) => a.meta.order - b.meta.order);
        if (edges.length !== route.chain.length)
          return unknown('chain-projection-mismatch', base);
        for (const [i, edge] of edges.entries()) {
          const node = graph.nodes.find((n) => n.id === edge.to),
            step = route.chain[i];
          if (
            edge.meta.order !== i ||
            edge.from !== (i === 0 ? rule.entrypoint : edges[i - 1].to) ||
            !node ||
            node.meta?.opaque ||
            node.loc?.file !== step.sourceFile ||
            node.loc?.line !== step.sourceLine
          )
            return unknown('chain-projection-mismatch', base);
        }
        const conditions = route.chain.slice(0, -1).map((step) => {
          if (step.conditional || step.role !== 'middleware')
            throw Error('unsupported-chain-step');
          return provenance(step);
        });
        const formulas = conditions.map((c) => c.formula),
          pathFormula =
            formulas.length === 0
              ? true
              : formulas.length === 1
                ? formulas[0]
                : ['and', ...formulas];
        const model = {
          schema: 'sparda-authorization-model/v1',
          basis: policy.basis,
          sourceHash: policy.sourceHash,
          entrypoint: rule.entrypoint,
          domain: true,
          path: pathFormula,
          allowed: allowed.tree,
        };
        const result = checkAuthorizationLogic(graph, model);
        return {
          ...result,
          ...base,
          conditionExtracted: true,
          scope: 'handler-entry-only',
          path: pathFormula,
          conditions,
          policy: allowed.tree,
          assumptions: [
            'stable-plain-session-data',
            'ordinary-express-next-response-semantics',
            'compiled-registration-bindings',
            'supplied-policy-is-authoritative',
            'terminal-handler-and-effect-feasibility-unmeasured',
          ],
        };
      } catch (error) {
        return unknown(error.message, { entrypoint: rule?.entrypoint ?? null });
      }
    });
    if (sourceHashOf(cwd, compilationFiles) !== graph.meta.sourceHash)
      return unknown('source-snapshot-mismatch', { checks: [] });
    // The aggregate cannot claim a complete measurement if any rule is unknown.
    return {
      schema: 'sparda-source-authorization-check/v1',
      status: checks.some((c) => c.status === 'UNKNOWN') ? 'UNKNOWN' : 'MEASURED',
      modelSatisfiable: checks.some((c) => c.status === 'UNKNOWN')
        ? null
        : checks.some((c) => c.modelSatisfiable),
      conditionExtracted: checks.every((c) => c.conditionExtracted === true)
        ? true
        : null,
      authorizationViolation: null,
      productionEligible: false,
      checks,
      sourceHash: graph.meta.sourceHash,
      policyHash: hash(JSON.stringify(policy)),
      compilationFiles,
    };
  } catch (error) {
    return unknown(error.message, { checks: [] });
  }
}
