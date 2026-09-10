// The only meeting point of the independent frontends. No fallback or union.
import { extractFastAPI } from '../../src/ubg/fastapi.js';
import { parseProject } from './parse.js';
import { resolveProject } from './resolve.js';
import { lowerSemanticProject } from './lower.js';
const routeKey = (r) =>
  JSON.stringify([
    r.method.toLowerCase(),
    r.path,
    r.sourceFile ?? r.provenance?.file,
    r.sourceLine ?? r.provenance?.line,
  ]);
const effectKey = (r, e) =>
  JSON.stringify([
    routeKey(r),
    e.effectType,
    e.op ?? null,
    e.table ?? null,
    e.line ?? e.provenance?.line,
    e.httpMethod ?? null,
    e.target ?? null,
  ]);
const provenanceKey = (p) => [
  p?.file,
  p?.sourceSha256,
  p?.line,
  p?.column,
  p?.startByte,
  p?.endByte,
];
const loweringEffectKey = (r, e) =>
  JSON.stringify([
    effectKey(r, e),
    provenanceKey(e.provenance),
    e.via?.map(provenanceKey),
    e.state,
  ]);
function difference(a, b) {
  const counts = new Map();
  for (const key of b) counts.set(key, (counts.get(key) ?? 0) + 1);
  const missing = [];
  for (const key of a) {
    if (counts.get(key)) counts.set(key, counts.get(key) - 1);
    else missing.push(key);
  }
  return missing;
}
export function compareExtractions(oracle, semantic, graph) {
  const unavailable = !oracle || !semantic || !graph;
  if (unavailable)
    return {
      state: 'UNKNOWN',
      zeroRouteLoss: null,
      zeroEffectLoss: null,
      zeroLoss: null,
      promotionEligible: false,
      authorizationParity: null,
      reason: 'frontend-unavailable',
    };
  const expectedRoutes = oracle.routes.map(routeKey),
    actualRoutes = semantic.routes.map(routeKey);
  const expectedEffects = oracle.routes.flatMap((r) =>
    [...oracle.globalMiddlewares, ...r.chain].flatMap((s) =>
      (s.scan?.effects ?? []).map((e) => effectKey(r, e)),
    ),
  );
  const actualEffects = semantic.routes.flatMap((r) =>
    r.effects.map((e) => effectKey(r, e)),
  );
  const missingRoutes = difference(expectedRoutes, actualRoutes),
    extraRoutes = difference(actualRoutes, expectedRoutes);
  const missingEffects = difference(expectedEffects, actualEffects),
    extraEffects = difference(actualEffects, expectedEffects);
  const boundaries =
    semantic.unknowns.length +
    (oracle.unknownHandlers?.length ?? 0) +
    (oracle.skipped?.length ?? 0);
  const graphRoutes = graph.nodes.filter((n) => n.kind === 'entrypoint').length;
  const graphEffects = graph.nodes.filter((n) => n.kind === 'effect').length;
  const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]));
  const loweredRoutes = graph.nodes
    .filter((n) => n.kind === 'entrypoint')
    .map((n) => ({
      method: n.meta.method,
      path: n.meta.path,
      sourceFile: n.loc?.file,
      sourceLine: n.loc?.line,
      id: n.id,
    }));
  const loweredEffects = loweredRoutes.flatMap((r) =>
    graph.edges
      .filter((e) => e.from === r.id)
      .map((e) => nodeIndex.get(e.to))
      .filter((n) => n?.kind === 'effect')
      .map((n) =>
        loweringEffectKey(r, {
          ...n.meta.semanticFact,
          ...n.meta,
          line: n.loc?.line,
          provenance: { ...n.meta.provenance, file: n.loc?.file, line: n.loc?.line },
        }),
      ),
  );
  const lostDuringLowering = {
    routes: difference(actualRoutes, loweredRoutes.map(routeKey)),
    routeProvenance: semantic.routes
      .filter((r) => {
        const lowered = graph.nodes.find(
          (n) => n.id === `entrypoint:${r.method.toUpperCase()} ${r.path}`,
        );
        return (
          JSON.stringify(r.pathProvenance?.map(provenanceKey)) !==
          JSON.stringify(lowered?.meta.pathProvenance?.map(provenanceKey))
        );
      })
      .map(routeKey),
    effects: difference(
      semantic.routes.flatMap((r) => r.effects.map((e) => loweringEffectKey(r, e))),
      loweredEffects,
    ),
  };
  const loweringLoss =
    graphRoutes !== semantic.routes.length ||
    graphEffects !== actualEffects.length ||
    lostDuringLowering.effects.length > 0;
  const routeLoss =
    missingRoutes.length > 0 ||
    graphRoutes !== semantic.routes.length ||
    lostDuringLowering.routes.length > 0 ||
    lostDuringLowering.routeProvenance.length > 0;
  const effectLoss = missingEffects.length > 0 || loweringLoss;
  const zeroRouteLoss = routeLoss ? false : boundaries ? null : true;
  const zeroEffectLoss = effectLoss ? false : boundaries ? null : true;
  return {
    state: routeLoss || effectLoss ? 'LOSS' : boundaries ? 'UNKNOWN' : 'CONSERVED',
    zeroRouteLoss,
    zeroEffectLoss,
    zeroLoss: routeLoss || effectLoss ? false : boundaries ? null : true,
    promotionEligible: false,
    authorizationParity: null,
    scope:
      'route identity and effect type/op/table/line/httpMethod/target multiplicity only; guards, filters, transactions and source-to-sink semantics are unmeasured',
    oracleEffectDefiningFileAvailable: false,
    counts: {
      oracleRoutes: expectedRoutes.length,
      candidateRoutes: actualRoutes.length,
      oracleEffects: expectedEffects.length,
      candidateEffects: actualEffects.length,
      graphRoutes,
      graphEffects,
      boundaries,
    },
    missingRoutes,
    extraRoutes,
    missingEffects,
    extraEffects,
    lostDuringLowering,
  };
}
export async function measureProject(root, entry, pythonCmd = 'python', options = {}) {
  const started = performance.now();
  const syntax = await parseProject(root, options);
  const semantic = resolveProject(syntax, entry, options);
  const graph = lowerSemanticProject(semantic);
  let oracle,
    oracleError = null;
  try {
    oracle = extractFastAPI(root, entry, pythonCmd);
  } catch (e) {
    oracleError = e.message;
  }
  return {
    comparison: compareExtractions(oracle, semantic, graph),
    semantic,
    graph,
    oracle: oracle ?? null,
    oracleError,
    parser: syntax.parser,
    sources: syntax.modules.map((m) => m.provenance),
    elapsedMs: performance.now() - started,
  };
}
