// Stage 3: semantic facts -> existing UBG schema; no Python syntax inspection.
// This experimental graph is never eligible for a production safety verdict.
import {
  createGraph,
  makeNode,
  makeEdge,
  addNode,
  addEdge,
  validateGraph,
  canonicalizeGraph,
} from '../../src/ubg/schema.js';
export function lowerSemanticProject(semantic) {
  const graph = createGraph({
    framework: 'fastapi',
    experimental: true,
    productionEligible: false,
    authorizationProven: null,
    semanticSchema: semantic.schema,
    unknowns: semantic.unknowns,
  });
  for (const [i, r] of semantic.routes.entries()) {
    const id = `entrypoint:${r.method.toUpperCase()} ${r.path}`;
    const route = addNode(
      graph,
      makeNode(
        id,
        'entrypoint',
        `${r.method.toUpperCase()} ${r.path}`,
        { file: r.provenance.file, line: r.provenance.line },
        {
          method: r.method,
          path: r.path,
          pathProvenance: r.pathProvenance,
          provenance: r.provenance,
          sources: r.sources,
          authorizationProven: null,
        },
      ),
    );
    for (const [j, d] of r.dependencies.entries()) {
      const dep = addNode(
        graph,
        makeNode(
          `logic:dependency:${i}:${j}`,
          'logic',
          d.target ?? 'unresolved dependency',
          { file: d.provenance.file, line: d.provenance.line },
          {
            binding: d,
            verified: false,
            authorizationProven: null,
            opaque: d.state === 'UNKNOWN',
          },
        ),
      );
      addEdge(graph, makeEdge('control_flow', route.id, dep.id, { dependency: true }));
    }
    for (const [j, e] of r.effects.entries()) {
      const effect = addNode(
        graph,
        makeNode(
          `effect:python:${i}:${j}`,
          'effect',
          `${e.effectType}:${e.table ?? '?'}`,
          { file: e.provenance.file, line: e.provenance.line },
          {
            effectType: e.effectType,
            op: e.op,
            table: e.table,
            provenance: e.provenance,
            semanticFact: e,
            via: e.via,
            state: e.state,
            opaque: e.state === 'UNKNOWN',
          },
        ),
      );
      addEdge(graph, makeEdge('control_flow', route.id, effect.id, { occurrence: true }));
    }
    for (const [j, u] of semantic.unknowns.entries()) {
      const boundary = addNode(
        graph,
        makeNode(
          `logic:unknown:${j}`,
          'logic',
          u.reason,
          u.provenance ? { file: u.provenance.file, line: u.provenance.line } : null,
          { opaque: true, boundary: u, state: 'UNKNOWN' },
        ),
      );
      addEdge(
        graph,
        makeEdge('control_flow', route.id, boundary.id, { conservativeBoundary: true }),
      );
    }
  }
  validateGraph(graph);
  return canonicalizeGraph(graph);
}
