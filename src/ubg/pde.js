// ubg/pde.js — Proof Diffusion Engine foundation.
//
// The UBG answers "what behavior did SPARDA observe?". This module answers a
// different question: "which independently checked claims may rely on which
// other claims?" Keeping those graphs separate is a soundness boundary.
//
// The engine is deliberately dependency-free. It implements:
//   - a strict three-state lattice (REFUTED / UNKNOWN / PROVEN),
//   - SCC grounding so circular certificates never prove themselves,
//   - an incremental reverse-cone update,
//   - a shared provenance DAG (traces are materialized only on request), and
//   - a hash-consed provenance DAG and BitNet-inspired ternary worklist.

export const PDE_STATUS = Object.freeze({
  REFUTED: 'refuted',
  UNKNOWN: 'unknown',
  PROVEN: 'proven',
});

// This is not a neural model. It borrows only BitNet b1.58's ternary storage
// idea for a fixed, auditable lattice. Every operation remains a deterministic
// table lookup: REFUTED < UNKNOWN < PROVEN, so a dependency can only preserve
// or lower confidence.
export const PDE_TERNARY_KERNEL = Object.freeze({
  id: 'sparda-pde-ternary-worklist/v1',
  cacheVersion: 'sparda-pde-ternary/v2',
  tritsPerByte: 5,
  theoreticalBitsPerState: Math.log2(3),
});

const RANK = Object.freeze({
  [PDE_STATUS.PROVEN]: 0,
  [PDE_STATUS.UNKNOWN]: 1,
  [PDE_STATUS.REFUTED]: 2,
});
const TRIT = Object.freeze({
  [PDE_STATUS.REFUTED]: 0,
  [PDE_STATUS.UNKNOWN]: 1,
  [PDE_STATUS.PROVEN]: 2,
});
const STATUS_FOR_TRIT = Object.freeze([
  PDE_STATUS.REFUTED,
  PDE_STATUS.UNKNOWN,
  PDE_STATUS.PROVEN,
]);
const POW3 = Object.freeze([1, 3, 9, 27, 81]);
const TRITS_PER_BYTE = 5;
const PDE_SUMMARY_REASON_LIMIT = 16;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort(cmp)
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

// Fixed-size deterministic ids keep a long provenance path linear in memory.
// Collisions are resolved against the canonical key, never trusted blindly.
function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(cmp);
}

function normalizeClaim(raw) {
  const certificate = raw.certificate ?? {};
  const status = certificate.status ?? PDE_STATUS.UNKNOWN;
  if (!(status in RANK)) throw new Error(`PDE: unknown certificate status ${status}`);
  if (!raw.id) throw new Error('PDE: every claim needs a stable id');
  return {
    id: raw.id,
    requires: uniqueSorted(raw.requires ?? []),
    certificate: {
      status,
      reason:
        certificate.reason ??
        (status === PDE_STATUS.UNKNOWN ? 'missing local certificate' : null),
    },
  };
}

function buildGraph(rawClaims) {
  const byId = new Map();
  for (const raw of rawClaims) {
    const claim = normalizeClaim(raw);
    if (byId.has(claim.id)) throw new Error(`PDE: duplicate claim ${claim.id}`);
    byId.set(claim.id, claim);
  }
  const claims = [...byId.values()].sort((a, b) => cmp(a.id, b.id));
  const dependents = new Map(claims.map((claim) => [claim.id, []]));
  let dependencyEdges = 0;
  for (const claim of claims)
    for (const required of claim.requires)
      if (byId.has(required)) {
        dependents.get(required).push(claim.id);
        dependencyEdges++;
      }
  for (const ids of dependents.values()) ids.sort(cmp);
  return { claims, byId, dependents, dependencyEdges };
}

// Tarjan's algorithm. SCCs are a semantic guard, not merely an optimization:
// a circular set of otherwise-valid certificates has no independent root.
export function stronglyConnectedComponents(rawClaims) {
  const { claims, byId } = buildGraph(rawClaims);
  let index = 0;
  const indexes = new Map();
  const lowlinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  const visit = (id) => {
    indexes.set(id, index);
    lowlinks.set(id, index);
    index++;
    stack.push(id);
    onStack.add(id);
    for (const next of byId.get(id).requires) {
      if (!byId.has(next)) continue;
      if (!indexes.has(next)) {
        visit(next);
        lowlinks.set(id, Math.min(lowlinks.get(id), lowlinks.get(next)));
      } else if (onStack.has(next)) {
        lowlinks.set(id, Math.min(lowlinks.get(id), indexes.get(next)));
      }
    }
    if (lowlinks.get(id) !== indexes.get(id)) return;
    const members = [];
    for (;;) {
      const member = stack.pop();
      onStack.delete(member);
      members.push(member);
      if (member === id) break;
    }
    components.push(members.sort(cmp));
  };

  for (const claim of claims) if (!indexes.has(claim.id)) visit(claim.id);
  return components.sort((a, b) => cmp(a[0], b[0]));
}

class ProvenanceDag {
  constructor(serialized = []) {
    this.nodes = new Map();
    this.keys = new Map();
    for (const node of serialized) {
      const { id, kind, ...payload } = node;
      this.nodes.set(id, node);
      this.keys.set(id, stable({ kind, ...payload }));
    }
  }

  intern(kind, payload) {
    const key = stable({ kind, ...payload });
    const baseId = `${kind}:${fnv1a32(key)}`;
    let id = baseId;
    let collision = 0;
    while (this.nodes.has(id) && this.keys.get(id) !== key) {
      collision++;
      id = `${baseId}:${collision}`;
    }
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, kind, ...payload });
      this.keys.set(id, key);
    }
    return id;
  }

  source(origin, reason) {
    return this.intern('source', { origin, reason });
  }

  edge(parent, claim) {
    return this.intern('edge', { parent, claim });
  }

  cycle(members) {
    return this.intern('cycle', { members: [...members].sort(cmp) });
  }

  serialize() {
    return [...this.nodes.values()].sort((a, b) => cmp(a.id, b.id));
  }

  materialize(id) {
    const suffix = [];
    let current = this.nodes.get(id);
    const seen = new Set();
    while (current?.kind === 'edge') {
      if (seen.has(current.id)) throw new Error('PDE: provenance edge cycle');
      seen.add(current.id);
      suffix.push(current.claim);
      current = this.nodes.get(current.parent);
    }
    if (!current)
      return {
        origin: 'unknown',
        reason: 'missing provenance node',
        path: suffix.reverse(),
      };
    if (current.kind === 'cycle')
      return {
        origin: `cycle:${current.members.join('→')}`,
        reason: 'circular certificates have no independent proof root',
        path: [...current.members, ...suffix.reverse()],
      };
    return {
      origin: current.origin,
      reason: current.reason,
      path: [current.origin, ...suffix.reverse()],
    };
  }
}

function state(status = PDE_STATUS.UNKNOWN, causeIds = []) {
  return { status, trit: TRIT[status], causeIds: uniqueSorted(causeIds) };
}

function sameState(a, b) {
  return (
    a.trit === b.trit &&
    a.causeIds.length === b.causeIds.length &&
    a.causeIds.every((causeId, index) => causeId === b.causeIds[index])
  );
}

function cycleCauses(claims, provenance) {
  const out = new Map();
  for (const component of stronglyConnectedComponents(claims)) {
    const selfLoop =
      component.length === 1 &&
      claims.find((claim) => claim.id === component[0])?.requires.includes(component[0]);
    if (component.length === 1 && !selfLoop) continue;
    const cause = provenance.cycle(component);
    for (const id of component) out.set(id, cause);
  }
  return out;
}

function initialState(id, cycles) {
  return cycles.has(id) ? state(PDE_STATUS.UNKNOWN, [cycles.get(id)]) : state();
}

function evaluate(claim, states, byId, cycles, provenance) {
  let trit = TRIT[claim.certificate.status];
  const causes = [];
  if (trit !== TRIT[PDE_STATUS.PROVEN])
    causes.push(provenance.source(claim.id, claim.certificate.reason));
  if (cycles.has(claim.id)) {
    trit = Math.min(trit, TRIT[PDE_STATUS.UNKNOWN]);
    causes.push(cycles.get(claim.id));
  }

  for (const required of claim.requires) {
    if (!byId.has(required)) {
      trit = Math.min(trit, TRIT[PDE_STATUS.UNKNOWN]);
      causes.push(provenance.source(required, 'required claim is not modelled'));
      continue;
    }
    const dependency = states.get(required) ?? state();
    trit = Math.min(trit, dependency.trit);
    if (dependency.trit === TRIT[PDE_STATUS.PROVEN]) continue;
    const inherited = dependency.causeIds.length
      ? dependency.causeIds
      : [provenance.source(required, 'required claim is unresolved')];
    for (const causeId of inherited) {
      // The SCC already contributes one shared "no independent root" cause to
      // each member. Re-wrapping that same cause through an internal edge would
      // create an infinite explanation a → b → a → … without adding knowledge.
      // External causes carried by a cyclic member still propagate normally.
      if (
        cycles.get(required) === cycles.get(claim.id) &&
        causeId === cycles.get(claim.id)
      )
        continue;
      causes.push(provenance.edge(causeId, claim.id));
    }
  }

  const status = STATUS_FOR_TRIT[trit];
  return status === PDE_STATUS.PROVEN ? state(PDE_STATUS.PROVEN) : state(status, causes);
}

function solvePrepared(prepared, { states = null, dirty = null } = {}) {
  const { claims, byId, dependents, cycles, provenance, dependencyEdges } = prepared;
  const nextStates = states
    ? new Map(states)
    : new Map(claims.map((claim) => [claim.id, initialState(claim.id, cycles)]));
  const scope = dirty ?? new Set(claims.map((claim) => claim.id));
  for (const id of scope) nextStates.set(id, initialState(id, cycles));

  const queue = [...scope].sort(cmp);
  const queued = new Set(queue);
  let head = 0;
  let evaluations = 0;
  let stateChanges = 0;
  const enqueue = (id) => {
    if (!scope.has(id) || queued.has(id)) return;
    queued.add(id);
    queue.push(id);
  };

  while (head < queue.length) {
    const id = queue[head++];
    queued.delete(id);
    evaluations++;
    const next = evaluate(byId.get(id), nextStates, byId, cycles, provenance);
    if (sameState(nextStates.get(id), next)) continue;
    stateChanges++;
    nextStates.set(id, next);
    for (const dependent of dependents.get(id)) enqueue(dependent);
  }
  return {
    claims,
    byId,
    states: nextStates,
    provenance,
    cycles,
    dependents,
    execution: Object.freeze({
      kernel: PDE_TERNARY_KERNEL.id,
      claims: claims.length,
      dependencyEdges,
      dirtyClaims: scope.size,
      evaluations,
      stateChanges,
      ternaryStatusBytes: Math.ceil(claims.length / TRITS_PER_BYTE),
    }),
  };
}

function prepare(rawClaims, provenance = new ProvenanceDag()) {
  const graph = buildGraph(rawClaims);
  return {
    ...graph,
    provenance,
    cycles: cycleCauses(graph.claims, provenance),
  };
}

export function solvePde(rawClaims) {
  return solvePrepared(prepare(rawClaims));
}

function reverseCone(dependents, roots) {
  const visited = new Set(roots);
  const queue = [...roots].sort(cmp);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const dependent of dependents.get(id) ?? []) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      queue.push(dependent);
    }
  }
  return visited;
}

// Differential update: re-evaluates only consumers that can depend on a
// changed certificate. The result is required to equal solvePde(nextClaims).
export function updatePde(previous, changes) {
  const byId = new Map(
    previous.byId ?? previous.claims.map((claim) => [claim.id, claim]),
  );
  const replacements = new Map();
  for (const change of changes) {
    const claim = byId.get(change.id);
    if (!claim) throw new Error(`PDE: unknown changed claim ${change.id}`);
    const replacement = {
      ...claim,
      requires: [...claim.requires],
      certificate: { ...claim.certificate, ...change.certificate },
    };
    replacements.set(change.id, replacement);
    byId.set(change.id, replacement);
  }
  const nextClaims = previous.claims.map((claim) => replacements.get(claim.id) ?? claim);
  const provenance = new ProvenanceDag(previous.provenance.serialize());
  // updatePde accepts certificate changes only. The module graph, reverse
  // dependencies and SCC grounding are therefore unchanged and can be reused
  // exactly; rebuilding Tarjan here would erase the incremental speed-up.
  const prepared = {
    claims: nextClaims,
    byId,
    dependents: previous.dependents,
    cycles: previous.cycles,
    provenance,
    dependencyEdges:
      previous.execution?.dependencyEdges ??
      [...previous.dependents.values()].reduce((total, ids) => total + ids.length, 0),
  };
  const dirty = reverseCone(
    prepared.dependents,
    changes.map((change) => change.id),
  );
  return solvePrepared(prepared, { states: previous.states, dirty });
}

export function explainPdeClaim(result, id) {
  const claim = result.states.get(id);
  if (!claim) throw new Error(`PDE: unknown claim ${id}`);
  return {
    status: claim.status,
    reasons: claim.causeIds.map((causeId) => result.provenance.materialize(causeId)),
  };
}

export function encodePdeStatusCache(result) {
  const ids = [...result.states.keys()].sort(cmp);
  const bytes = new Uint8Array(Math.ceil(ids.length / TRITS_PER_BYTE));
  const causes = {};
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    const claim = result.states.get(id);
    bytes[Math.floor(index / TRITS_PER_BYTE)] +=
      claim.trit * POW3[index % TRITS_PER_BYTE];
    if (claim.status !== PDE_STATUS.PROVEN) causes[id] = claim.causeIds;
  }
  return {
    v: PDE_TERNARY_KERNEL.cacheVersion,
    ids,
    bytes,
    causes,
    provenance: result.provenance.serialize(),
  };
}

export function decodePdeStatusCache(snapshot) {
  if (
    !['sparda-pde-bitnet-1.58/v1', PDE_TERNARY_KERNEL.cacheVersion].includes(snapshot?.v)
  )
    throw new Error('PDE: unsupported cache');
  if (!(snapshot.bytes instanceof Uint8Array))
    throw new Error('PDE: cache bytes are invalid');
  if (snapshot.bytes.length !== Math.ceil(snapshot.ids.length / TRITS_PER_BYTE))
    throw new Error('PDE: cache byte length is invalid');
  const states = new Map();
  for (let index = 0; index < snapshot.ids.length; index++) {
    const id = snapshot.ids[index];
    if (!id || states.has(id)) throw new Error('PDE: cache ids are invalid');
    const byte = snapshot.bytes[Math.floor(index / TRITS_PER_BYTE)];
    const trit = Math.floor(byte / POW3[index % TRITS_PER_BYTE]) % 3;
    const status = STATUS_FOR_TRIT[trit];
    states.set(
      id,
      state(status, status === PDE_STATUS.PROVEN ? [] : (snapshot.causes?.[id] ?? [])),
    );
  }
  return { states, provenance: new ProvenanceDag(snapshot.provenance) };
}

const UBG_DIFFUSION_EDGE_KINDS = new Set(['control_flow', 'gate']);

function collectionValues(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  return [];
}

function pdeNodeId(nodeId) {
  return `ubg:node:${nodeId}`;
}

function pdeEntrypointId(nodeId) {
  return `ubg:entrypoint:${nodeId}`;
}

function ubgNodeCertificate(node) {
  const meta = node.meta ?? {};
  if (node.kind === 'guard' && meta.verified !== true)
    return {
      status: PDE_STATUS.UNKNOWN,
      reason: 'guard has no independently checked deny path',
    };
  if (meta.opaque === true)
    return {
      status: PDE_STATUS.UNKNOWN,
      reason: `${node.kind} body is opaque`,
    };
  if (meta.dynamicMember === true)
    return {
      status: PDE_STATUS.UNKNOWN,
      reason: `${node.kind} uses a dynamic member`,
    };
  return {
    status: PDE_STATUS.PROVEN,
    reason: `UBG ${node.kind} node is structurally modelled`,
  };
}

// Lower the canonical UBG into diagnostic claims. Edges retain their execution
// direction: a node's diagnostic status depends on the work it can reach. This
// makes an unread guard/effect travel back to its entrypoint through the exact
// control-flow chain, while the SCC rule still prevents a cycle from becoming
// its own certificate. The returned claims are only consumed by the PDE adapter
// below; they never reach verdictOf().
export function pdeClaimsFromUbg(graph) {
  if (graph == null)
    return {
      claims: [],
      verdictRequirements: [],
      stats: {
        provided: false,
        nodes: 0,
        diffusionEdges: 0,
        entrypoints: 0,
        opaqueNodes: 0,
      },
    };

  const nodes = collectionValues(graph.nodes)
    .filter((node) => typeof node?.id === 'string' && node.id)
    .sort((a, b) => cmp(a.id, b.id));
  const knownIds = new Set(nodes.map((node) => node.id));
  const requires = new Map(nodes.map((node) => [node.id, []]));
  let diffusionEdges = 0;
  for (const edge of collectionValues(graph.edges)
    .filter((edge) => UBG_DIFFUSION_EDGE_KINDS.has(edge?.kind))
    .sort((a, b) =>
      cmp(
        `${a.kind}\u0000${a.from}\u0000${a.to}`,
        `${b.kind}\u0000${b.from}\u0000${b.to}`,
      ),
    )) {
    if (!knownIds.has(edge.from)) continue;
    requires.get(edge.from).push(pdeNodeId(edge.to));
    diffusionEdges++;
  }

  const nodeClaims = nodes.map((node) => ({
    id: pdeNodeId(node.id),
    certificate: ubgNodeCertificate(node),
    requires: requires.get(node.id),
  }));
  const entrypoints = nodes.filter((node) => node.kind === 'entrypoint');
  const entrypointClaims = entrypoints.map((node) => ({
    id: pdeEntrypointId(node.id),
    certificate: {
      status: PDE_STATUS.PROVEN,
      reason: 'UBG entrypoint registration is structurally modelled',
    },
    requires: [pdeNodeId(node.id)],
  }));
  const routeSurfaceClaim = {
    id: 'ubg:route-surface',
    certificate:
      entrypoints.length > 0
        ? {
            status: PDE_STATUS.PROVEN,
            reason: `${entrypoints.length} UBG entrypoint(s) available for diagnosis`,
          }
        : {
            status: PDE_STATUS.UNKNOWN,
            reason: 'UBG contains no entrypoint to diagnose',
          },
    requires: entrypointClaims.map((claim) => claim.id),
  };

  return {
    claims: [...nodeClaims, ...entrypointClaims, routeSurfaceClaim],
    verdictRequirements: [routeSurfaceClaim.id],
    stats: {
      provided: true,
      nodes: nodes.length,
      diffusionEdges,
      entrypoints: entrypoints.length,
      opaqueNodes: nodes.filter(
        (node) =>
          node.meta?.opaque === true ||
          node.meta?.dynamicMember === true ||
          (node.kind === 'guard' && node.meta?.verified !== true),
      ).length,
    },
  };
}

function pdeClaimsFromDeclaredUncertainty(report) {
  if (report == null)
    return {
      claims: [],
      verdictRequirements: [],
      count: 0,
    };
  const declared = [
    ...(report.unknownHandlers ?? []).map((handler) => ({
      type: 'unknown-handler',
      value: handler,
    })),
    ...(report.skipped ?? [])
      .filter((skip) => ['critical', 'high'].includes(skip?.risk))
      .map((skip) => ({ type: 'high-risk-skip', value: skip })),
  ].sort((a, b) => cmp(stable(a), stable(b)));
  const claims = declared.map(({ type, value }, index) => ({
    id: `ubg:declared-uncertainty:${String(index).padStart(4, '0')}:${fnv1a32(stable(value))}`,
    certificate: {
      status: PDE_STATUS.UNKNOWN,
      reason:
        type === 'unknown-handler'
          ? 'UBG declared an unbindable handler registration'
          : 'UBG declared a high-risk skipped surface',
    },
  }));
  const aggregate = {
    id: 'ubg:declared-uncertainty',
    certificate:
      claims.length === 0
        ? {
            status: PDE_STATUS.PROVEN,
            reason: 'UBG declared no high-risk unmodelled surface',
          }
        : {
            status: PDE_STATUS.UNKNOWN,
            reason: `${claims.length} high-risk UBG uncertainty declaration(s)`,
          },
    requires: claims.map((claim) => claim.id),
  };
  return {
    claims: [...claims, aggregate],
    verdictRequirements: [aggregate.id],
    count: claims.length,
  };
}

// The first SPARDA adapter is intentionally diagnostic-only. It makes existing
// honesty facts explicit in the PDE without changing verdictOf(). The future
// proof kernel, once certificates are independently checkable, is the only
// component allowed to make this graph authoritative for PROVEN.
export function pdeClaimsForSparda({
  premiseBasis,
  blindHigh,
  findings,
  semanticLedger = null,
  graph = null,
  report = null,
}) {
  const hardFindings = (findings ?? []).filter((finding) =>
    ['critical', 'high'].includes(finding.severity),
  );
  const semanticClaims =
    semanticLedger === null
      ? []
      : [
          {
            id: 'coverage:semantic-facts',
            certificate:
              Array.isArray(semanticLedger?.unmeasured) &&
              semanticLedger.unmeasured.length === 0
                ? {
                    status: PDE_STATUS.PROVEN,
                    reason: 'semantic facts were conserved',
                  }
                : {
                    status: PDE_STATUS.UNKNOWN,
                    reason: 'semantic fact surface remains unmeasured or malformed',
                  },
          },
        ];
  const ubg = pdeClaimsFromUbg(graph);
  const declaredUncertainty = pdeClaimsFromDeclaredUncertainty(report);
  return [
    {
      id: 'premise:route-surface',
      certificate:
        premiseBasis === 'unmeasured'
          ? {
              status: PDE_STATUS.UNKNOWN,
              reason: 'route surface was not independently measured',
            }
          : {
              status: PDE_STATUS.PROVEN,
              reason: `premise basis: ${premiseBasis}`,
            },
    },
    {
      id: 'coverage:high-risk-surface',
      certificate:
        blindHigh > 0
          ? {
              status: PDE_STATUS.UNKNOWN,
              reason: `${blindHigh} high-risk blind spot(s)`,
            }
          : { status: PDE_STATUS.PROVEN, reason: 'no high-risk blind spot' },
    },
    {
      id: 'obligations:static',
      certificate: hardFindings.length
        ? {
            status: PDE_STATUS.REFUTED,
            reason: `${hardFindings.length} critical/high static finding(s)`,
          }
        : {
            status: PDE_STATUS.PROVEN,
            reason: 'no critical/high static finding',
          },
    },
    ...semanticClaims,
    ...ubg.claims,
    ...declaredUncertainty.claims,
    {
      id: 'verdict:eligibility',
      certificate: {
        status: PDE_STATUS.PROVEN,
        reason: 'PDE verdict rule checked locally',
      },
      requires: [
        'premise:route-surface',
        'coverage:high-risk-surface',
        'obligations:static',
        ...semanticClaims.map((claim) => claim.id),
        ...ubg.verdictRequirements,
        ...declaredUncertainty.verdictRequirements,
      ],
    },
  ];
}

export function pdeSummaryForSparda(input) {
  const result = solvePde(pdeClaimsForSparda(input));
  const verdict = result.states.get('verdict:eligibility');
  const reasonIds = verdict.causeIds;
  const cache = encodePdeStatusCache(result);
  const ubg = pdeClaimsFromUbg(input.graph);
  const declaredUncertainty = pdeClaimsFromDeclaredUncertainty(input.report);
  return {
    diagnosticOnly: true,
    authority: 'none',
    status: verdict.status,
    // The graph keeps every provenance edge, but a normal CLI/MCP response must
    // remain bounded on a giant. A consumer that needs a complete trace uses
    // explainPdeClaim(); this summary exposes the total so truncation is never
    // mistaken for absence.
    reasons: reasonIds
      .slice(0, PDE_SUMMARY_REASON_LIMIT)
      .map((causeId) => result.provenance.materialize(causeId)),
    reasonCount: reasonIds.length,
    reasonsTruncated: reasonIds.length > PDE_SUMMARY_REASON_LIMIT,
    ubg: {
      ...ubg.stats,
      declaredUncertainty: declaredUncertainty.count,
    },
    cache: {
      statusBytes: cache.bytes.length,
      states: cache.ids.length,
      theoreticalBitsPerState: PDE_TERNARY_KERNEL.theoreticalBitsPerState,
    },
    execution: result.execution,
  };
}
