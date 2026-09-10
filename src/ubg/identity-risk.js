// An automatic risk detector, NOT a policy inference or an exploitation proof.
// The join needs both a structurally described session admission and a resolved,
// route-local client→filter path. Equal field names are an explicit hypothesis
// about identity, never an established business ownership requirement.
import { buildCfIndex, reachFrom } from './reach.js';
const RULE = 'CLIENT_SELECTED_IDENTITY';
function admission(reached, ep, registered) {
  if (
    ep.meta?.ownerAsserted ||
    reached.some((n) => n.meta?.opaque || n.meta?.ownerScoped)
  )
    return null;
  // One admission middleware, then the handler. Registration edges, not a
  // function's reused node role, establish how Express invokes its parameters.
  if (registered.length !== 2) return null;
  const guard = registered[0],
    s = guard.meta?.sessionAdmission;
  if (
    !s ||
    s.schema !== 'session-admission/v1' ||
    s.origin !== 'session' ||
    s.condition !== 'truthy' ||
    s.rejection !== 'returns-without-next' ||
    typeof s.name !== 'string' ||
    !s.name
  )
    return null;
  if (reached.some((n) => n.kind === 'guard' && n.id !== guard.id)) return null;
  if (
    reached.some(
      (n) =>
        n.id !== guard.id &&
        (n.meta?.bodyDenies || n.meta?.bodyVerifies || n.meta?.bodyRedirects),
    )
  )
    return null;
  return guard;
}
function routeSteps(ep, edges, nodes) {
  return edges
    .filter((e) => e.kind === 'control_flow' && e.meta?.route === ep.id)
    .sort((a, b) => a.meta.order - b.meta.order)
    .map((e) => nodes.get(e.to))
    .filter(Boolean);
}
export function attachIdentityRiskEvidence(graph, facts) {
  if (
    graph.meta?.framework !== 'express' ||
    !Array.isArray(facts) ||
    facts.length > 200000
  )
    return;
  const edges = [...graph.edges.values()],
    cf = buildCfIndex(edges),
    paths = new Map(),
    occurrences = new Map();
  for (const f of facts) {
    if (f.kind === 'DataFlowPath') {
      if (!paths.has(f.entrypoint)) paths.set(f.entrypoint, []);
      paths.get(f.entrypoint).push(f);
    } else if (f.kind === 'DbEffectOccurrence') {
      occurrences.set(`${f.entrypoint}:${f.owner}:${f.effect}`, f);
    }
  }
  for (const ep of graph.nodes.values()) {
    if (ep.kind !== 'entrypoint') continue;
    const reached = [...reachFrom(ep.id, cf)]
      .map((id) => graph.nodes.get(id))
      .filter(Boolean);
    const guard = admission(reached, ep, routeSteps(ep, edges, graph.nodes));
    if (!guard) continue;
    const evidence = [];
    for (const f of paths.get(ep.id) ?? []) {
      if (
        f.role !== 'filter' ||
        f.state !== 'resolved' ||
        !Array.isArray(f.path) ||
        f.path.some((step) => /\(\)$/.test(step) && step !== 'parseInt()') ||
        !['body', 'params', 'query'].includes(f.source?.origin) ||
        f.source.name !== guard.meta.sessionAdmission.name ||
        !/^filter\.[A-Za-z_][\w$]*$/.test(f.destination)
      )
        continue;
      const occurrence = occurrences.get(`${ep.id}:${f.owner}:${f.effect}`);
      const effect = graph.nodes.get(f.effect);
      if (
        !occurrence ||
        occurrence.symbolicTarget ||
        !occurrence.table ||
        occurrence.ownerScoped ||
        !effect ||
        !reached.includes(effect)
      )
        continue;
      evidence.push({
        pathFact: f.id,
        guard: guard.id,
        effect: f.effect,
        occurrence: occurrence.id,
        table: occurrence.table,
        access: occurrence.access,
        session: guard.meta.sessionAdmission.name,
        source: f.source,
        destination: f.destination,
        path: f.path,
        provenance: f.provenance,
      });
    }
    if (evidence.length) ep.meta.identityRiskEvidence = evidence;
  }
}
export function identityRiskFindings(ep, reached, edges) {
  if (!ep.meta?.identityRiskEvidence) return [];
  const guard = admission(
    reached,
    ep,
    routeSteps(ep, edges, new Map(reached.map((n) => [n.id, n]))),
  );
  if (!guard) return [];
  const evidence = (ep.meta?.identityRiskEvidence ?? []).filter(
    (e) =>
      e.guard === guard.id &&
      e.session === guard.meta.sessionAdmission.name &&
      e.source?.name === e.session &&
      ['body', 'params', 'query'].includes(e.source.origin) &&
      reached.some(
        (n) =>
          n.id === e.effect &&
          n.kind === 'effect' &&
          !n.meta?.symbolic &&
          !n.meta?.ownerScoped,
      ),
  );
  if (!evidence.length) return [];
  return [
    {
      rule: RULE,
      severity: 'high',
      advisory: false,
      entrypoint: ep.id,
      classification: 'risk-candidate',
      authorizationViolation: null,
      exploitability: null,
      assumptions: [
        'The equally named session and request fields represent the same identity domain.',
        'Access to this resource should be restricted to the caller; sharing or an external policy can make this legitimate.',
      ],
      message: `${ep.label}: session.${guard.meta.sessionAdmission.name} admits the request, while the client selects the database identity — potential cross-account access; intended ownership/role policy is unconfirmed`,
      evidence: evidence.map(
        (e) => `${e.path.join(' → ')} (${e.provenance.file}:${e.provenance.line})`,
      ),
      identityEvidence: evidence,
    },
  ];
}
