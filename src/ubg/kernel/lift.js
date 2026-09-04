// ubg/kernel/lift.js — the compiled UBG, read as kernel facts.
//
// Lifting reads the graph rather than the syntax on purpose. The graph is what
// every downstream consumer grades, so a fact derived from it cannot describe a
// program the prover never saw — the failure mode where an analyser's internal
// model and its published model drift apart, and the published one is the one
// that lies (E-104).
//
// The exception is `AsyncContinuation` and `UnknownBoundary`: a continuation is
// syntax the graph does not carry, so `translate` stamps it onto the owning
// node's meta, and an unresolved hop is by definition absent from the graph, so
// `resolve.js` records it as it happens. Both arrive here already conserved.
import { cmp } from '../schema.js';
import {
  UNKNOWN_ACCESS_PATH,
  createLedger,
  factId,
  guardBoundaryProof,
  ledgerFacts,
  makeFact,
  record,
  summarizeLedger,
} from './facts.js';

const locOf = (node) => ({
  file: node.loc?.file ?? '<unknown>',
  line: node.loc?.line ?? 0,
});

// Which request surface an entrypoint's declared inputs come from. Express path
// parameters are `params` by construction — the router binds them — so this is a
// structural read of the route, not an inference about the handler.
function routeDataSources(ledger, entrypoint) {
  const { file, line } = locOf(entrypoint);
  for (const input of entrypoint.meta?.inputs ?? []) {
    if (!input?.name) continue;
    record(
      ledger,
      makeFact(
        'DataSource',
        factId('DataSource', file, line, `params:${input.name}`),
        {
          origin: 'params',
          name: input.name,
          type: input.type ?? null,
          entrypoint: entrypoint.id,
        },
        {
          file,
          line,
          symbol: input.name,
          contract: 'express/router',
        },
      ),
    );
  }
}

// A DB effect, with everything the persistence contracts could prove about it.
// Each field is present only when it was READ; an absent `table` is a target we
// could not resolve, and `symbolic` says which of the two it is (rule 13 applied
// to a field rather than to a headline).
function dbEffectFacts(ledger, node) {
  const { file, line } = locOf(node);
  const meta = node.meta ?? {};
  if (meta.effectType !== 'db_read' && meta.effectType !== 'db_write') return;
  // A target we could not read is a STOP, not merely a field left blank. Carried
  // as its own boundary so it is countable in `byUncertainty` beside every other
  // place the walk ran out of structure — a reader auditing "what did SPARDA not
  // see?" must not have to know that this one hides inside a DbEffect's
  // provenance instead of appearing in the boundary list.
  if (meta.table == null)
    record(
      ledger,
      makeFact(
        'UnknownBoundary',
        factId('UnknownBoundary', file, line, `dynamic-target:${node.id}`),
        {
          symbol: node.label ?? node.id,
          detail: meta.symbolic
            ? 'the collection/table name is a request-derived rule, not a literal'
            : 'the collection/table name is not statically readable',
          owner: node.id,
        },
        {
          file,
          line,
          symbol: node.label ?? null,
          contract: 'node/resolve',
          uncertainty: 'dynamic-target',
        },
      ),
    );
  record(
    ledger,
    makeFact(
      'DbEffect',
      factId('DbEffect', file, line, `${meta.effectType}:${meta.op ?? '?'}:${node.id}`),
      {
        node: node.id,
        access: meta.effectType === 'db_write' ? 'write' : 'read',
        op: meta.op ?? null,
        // `null` table + `symbolic` true = "a target expressed as a rule";
        // `null` + not symbolic = "we could not read it". Two different states,
        // and collapsing them is exactly what rule 13 forbids.
        table: meta.table ?? null,
        symbolicTarget: meta.symbolic === true,
        filter: meta.where ?? null,
        filterRequestDerived: meta.filterTainted === true,
        dataRequestDerived: meta.tainted === true,
        idScoped: meta.idScoped === true,
        ownerScoped: meta.ownerScoped === true,
        transaction: meta.transaction?.id ?? null,
        rollback: meta.onFailure?.action ?? null,
      },
      {
        file,
        line,
        symbol: meta.table ?? null,
        contract: meta.symbolic ? 'mongo/driver' : contractFor(meta),
        uncertainty:
          meta.table == null && meta.symbolic !== true ? 'dynamic-target' : null,
      },
    ),
  );
}

// Which persistence contract is answerable for this effect. `driver` is the
// default because the collection-handle contract is the one that resolves a
// captured Mongo receiver; a Prisma/SQL effect predates the kernel and is
// attributed to its own contract so a wrong fact is traceable to a rule.
function contractFor(meta) {
  if (meta.driver === 'prisma') return 'prisma/client';
  if (meta.driver) return 'sql/builder';
  return 'mongo/driver';
}

// The four obligations, evaluated against the graph. Nothing here reads a name:
// `denyPathProven` is the extractor's `verified` flag, which is set only when a
// refusal was SEEN in the guard's own body.
function guardBoundaryFacts(ledger, graph, entrypoint, chain, mutatingEffects) {
  for (const guard of chain.filter((node) => node.kind === 'guard')) {
    const { file, line } = locOf(guard);
    const gates = graph.edges.some(
      (edge) => edge.kind === 'gate' && edge.from === guard.id,
    );
    // Obligation 4: every mutation this route performs sits behind the guard.
    // A route with no mutation discharges it vacuously — and says so, rather
    // than borrowing credit it was never asked for.
    const dominated =
      mutatingEffects.length === 0
        ? true
        : mutatingEffects.every((effect) => effect.meta?.bypassesGuard !== true);
    const proof = guardBoundaryProof({
      onRouteChain: true,
      denyPathProven: guard.meta?.verified === true,
      allowPathReachesHandler: gates,
      mutationDominated: dominated,
    });
    record(
      ledger,
      makeFact(
        'GuardBoundary',
        factId('GuardBoundary', file, line, `${entrypoint.id}:${guard.id}`),
        {
          guard: guard.id,
          entrypoint: entrypoint.id,
          ...proof,
          vacuousDominance: mutatingEffects.length === 0,
        },
        {
          file,
          line,
          symbol: guard.label ?? null,
          contract: 'express/router',
          uncertainty: proof.credited
            ? null
            : proof.unmet.includes('denyPathProven')
              ? 'no-deny-path'
              : 'no-allow-path',
        },
      ),
    );
  }
}

function continuationFacts(ledger, node) {
  const { file } = locOf(node);
  for (const continuation of node.meta?.continuations ?? []) {
    record(
      ledger,
      makeFact(
        'AsyncContinuation',
        factId(
          'AsyncContinuation',
          file,
          continuation.line,
          `${continuation.form}:${continuation.symbol ?? '<anonymous>'}`,
        ),
        {
          form: continuation.form,
          symbol: continuation.symbol ?? null,
          owner: node.id,
        },
        {
          file,
          line: continuation.line,
          symbol: continuation.symbol ?? null,
          contract: 'node/callback',
        },
      ),
    );
  }
}

// Every node reachable from an entrypoint through the control-flow edges that
// carry THIS route. Route-scoped, because a middleware shared by N routes fans
// out to N handlers and a request only ever walks one of those edges.
function reachedBy(graph, entrypointId, adjacency) {
  const seen = new Set();
  const queue = [entrypointId];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

// TAPP-1 — the steps a request value took to reach one role, on THIS route.
//
// The identity carries the entrypoint, the owning body, the canonical effect, the
// role, the source AND the destination. The entrypoint is why two routes sharing a
// handler produce two facts instead of one shared proof; the destination is why a
// source landing in two payload keys produces two paths instead of one that quietly
// picks a winner.
//
// A role whose paths are `null` was never measurable and emits nothing — an
// invented `unknown` there would claim an inspection that did not happen. A role
// inspected with nothing request-derived in it emits nothing either, because there
// was no journey to describe. Only a value that PROVABLY reached the role produces
// a fact, resolved or declared.
function dataFlowFacts(ledger, entrypoint, occurrence) {
  for (const [role, key] of [
    ['filter', 'filterPaths'],
    ['data', 'dataPaths'],
  ]) {
    if (!Array.isArray(occurrence[key])) continue;
    for (const entry of occurrence[key]) {
      const resolved = entry.state === 'resolved';
      record(
        ledger,
        makeFact(
          'DataFlowPath',
          factId(
            'DataFlowPath',
            occurrence.file,
            occurrence.line,
            `${entrypoint.id}:${occurrence.owner}:${occurrence.effect}:${role}:${entry.origin}.${entry.name ?? '*'}:${entry.dest ?? '<unknown>'}`,
          ),
          {
            entrypoint: entrypoint.id,
            owner: occurrence.owner,
            effect: occurrence.effect,
            role,
            source: { origin: entry.origin, name: entry.name ?? null },
            path: resolved ? entry.path : null,
            destination: entry.dest ?? null,
            state: entry.state,
            boundary: resolved ? null : UNKNOWN_ACCESS_PATH,
          },
          {
            file: occurrence.file,
            line: occurrence.line,
            symbol: entry.dest ?? null,
            contract: 'node/dataflow',
            uncertainty: resolved ? null : 'unknown-access-path',
          },
        ),
      );
    }
  }
}

// One occurrence per (route, owner body, effect). The route key is what stops
// provenance from leaking sideways: without it, the first body to reach a shared
// effect node decides what every other route "proved" about it.
function occurrenceFacts(ledger, entrypoint, reachable, occurrences) {
  for (const occurrence of occurrences) {
    if (!reachable.has(occurrence.owner)) continue;
    record(
      ledger,
      makeFact(
        'DbEffectOccurrence',
        factId(
          'DbEffectOccurrence',
          occurrence.file,
          occurrence.line,
          `${entrypoint.id}:${occurrence.owner}:${occurrence.effect}`,
        ),
        {
          entrypoint: entrypoint.id,
          // The interprocedural path in one field: which body of which route
          // produced this, and which canonical operation it is an instance of.
          owner: occurrence.owner,
          effect: occurrence.effect,
          access: occurrence.access,
          op: occurrence.op,
          table: occurrence.table,
          symbolicTarget: occurrence.symbolicTarget,
          filter: occurrence.filter,
          filterOrigins: occurrence.filterOrigins,
          dataOrigins: occurrence.dataOrigins,
          filterRequestDerived: occurrence.filterRequestDerived,
          dataRequestDerived: occurrence.dataRequestDerived,
          ownerScoped: occurrence.ownerScoped,
          idScoped: occurrence.idScoped,
        },
        {
          file: occurrence.file,
          line: occurrence.line,
          symbol: occurrence.table ?? null,
          contract: 'mongo/driver',
          uncertainty: occurrence.table == null ? 'dynamic-target' : null,
        },
      ),
    );
    dataFlowFacts(ledger, entrypoint, occurrence);
  }
}

// Nest static direct provider V1 — ADR-102.
//
// Route-scoped like every other evidence fact here. `effect` is the id of the
// existing effect node for this operation when the compiled graph has one, and
// `null` when it does not — which is a MEASUREMENT ("the route and the ORM call
// are both proved and no effect node exists"), never a claim that nothing
// happens. `[]` or an absent key would say the second thing (rule 13).
//
// It creates no node and mutates none. A route may not become cleaner because a
// provider was proved: this fact is evidence a later rule may consume, and by
// itself it credits nothing.
function providerLinkageFacts(ledger, graph, linkages) {
  const effectsByFileOp = new Map();
  for (const node of graph.nodes) {
    if (node.kind !== 'effect') continue;
    const key = `${node.loc?.file ?? ''}:${node.loc?.line ?? 0}`;
    if (!effectsByFileOp.has(key)) effectsByFileOp.set(key, node.id);
  }
  for (const link of linkages) {
    const effect = effectsByFileOp.get(`${link.providerFile}:${link.line}`) ?? null;
    record(
      ledger,
      makeFact(
        'ProviderLinkage',
        factId(
          'ProviderLinkage',
          link.providerFile,
          link.line,
          `${link.entrypoint}:${link.controller}:${link.provider}:${link.op}:${link.entity}`,
        ),
        {
          entrypoint: link.entrypoint,
          controller: link.controller,
          provider: link.provider,
          orm: link.orm,
          pkg: link.pkg,
          op: link.op,
          entity: link.entity,
          entityFile: link.entityFile,
          effect,
          // Never a type, never a decorator name, never a parameter name.
          basis: 'module-literal',
          // ADR-106 — the strict eight-link receipt, or `null`. `null` is the
          // MEASUREMENT "this chain is proved by the ADR-102 grammar and not by
          // the strict one", never "the strict grammar was not asked" (rule 13).
          // Every link inside a non-null receipt carries its own provenance; a
          // receipt missing one is not a weaker receipt, it is not a receipt.
          strict: link.strict ?? null,
        },
        {
          file: link.providerFile,
          line: link.line,
          symbol: `${link.provider}.${link.op}`,
          // One fact kind, two contracts. ADR-102 proves a chain gated on an
          // official `forFeature`; ADR-106 proves the eight-link chain and needs
          // no `forFeature`, so it accepts three shapes ADR-102 refuses on
          // purpose. Naming which contract spoke is what lets each be asserted
          // without inferring it from a package name.
          contract: link.grammar === 'adr-106' ? 'nest/strict-chain' : 'nest/provider',
        },
      ),
    );
    providerFlowFacts(ledger, link, effect);
  }
}

// ADR-104 — the request provenance ON a proved provider chain.
//
// Reuses `DataFlowPath` rather than inventing a ninth fact kind, because it IS
// that fact: the ordered static steps a request value took to reach one role of
// one DB operation, on one route. The identity is keyed the same way and for the
// same reason — the entrypoint is in it, so two routes reaching one service
// method produce two facts and never one shared proof.
//
// `owner` is `null` and that is a measurement, not an omission: this chain is
// proved from the SOURCE (a module literal, an import specifier, an argument
// position), not from a compiled body, so there is no owner node to name. `effect`
// carries the existing effect node's id where the graph has one, exactly as the
// ProviderLinkage above does, and `null` where it does not — "both ends proved and
// no effect node exists", never "nothing happens".
//
// It is evidence. It credits no guard, creates no finding and moves no verdict;
// `unknown-access-path` is absent from `BOUNDARY_AFFECTS`, so a REFUSED path
// degrades nothing either.
function providerFlowFacts(ledger, link, effect) {
  for (const flow of link.flows ?? []) {
    const resolved = flow.state === 'resolved';
    record(
      ledger,
      makeFact(
        'DataFlowPath',
        factId(
          'DataFlowPath',
          link.providerFile,
          link.line,
          `${link.entrypoint}:${link.controller}:${link.provider}:${link.op}:${flow.role ?? '<unroled>'}:${flow.source.origin}.${flow.source.name ?? '*'}:${flow.dest ?? '<unknown>'}`,
        ),
        {
          entrypoint: link.entrypoint,
          owner: null,
          effect,
          role: flow.role,
          source: flow.source,
          path: resolved ? flow.path : null,
          destination: flow.dest,
          state: flow.state,
          boundary: resolved ? null : UNKNOWN_ACCESS_PATH,
          // The chain this path travelled, and what proved it. Never a type,
          // never a decorator name, never a parameter name (ADR-102's rule, one
          // layer up).
          linkage: `${link.controller} → ${link.provider} → ${link.entity}.${link.op}`,
          basis: 'module-literal',
          // WHICH refusal, from the closed list — `null` on a resolved path. The
          // provenance carries the CAUSE (`unknown-access-path`); this names the
          // shape, so a reader can act on it instead of re-deriving it.
          refusal: flow.reason,
        },
        {
          file: link.providerFile,
          line: link.line,
          symbol: flow.dest ?? null,
          contract: 'nest/provider-tapp',
          uncertainty: resolved ? null : 'unknown-access-path',
        },
      ),
    );
  }
}

export function liftKernelFacts(
  graph,
  { ledger = createLedger(), occurrences = [], providerLinkages = [] } = {},
) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const routeChains = new Map(); // entrypoint id → ordered chain nodes

  // Route-scoped adjacency: an edge stamped with a route belongs to that route
  // only; an unstamped body edge (handler → effect, handler → helper) belongs to
  // whichever body it hangs off, so it is shared.
  const shared = new Map();
  for (const edge of graph.edges) {
    if (edge.kind !== 'control_flow') continue;
    if (edge.meta?.route) {
      const chain = routeChains.get(edge.meta.route) ?? [];
      chain.push({ order: edge.meta.order ?? 0, id: edge.to });
      routeChains.set(edge.meta.route, chain);
      continue;
    }
    if (!shared.has(edge.from)) shared.set(edge.from, []);
    shared.get(edge.from).push(edge.to);
  }

  for (const node of graph.nodes) continuationFacts(ledger, node);
  for (const node of graph.nodes) dbEffectFacts(ledger, node);

  for (const entrypoint of graph.nodes.filter((node) => node.kind === 'entrypoint')) {
    routeDataSources(ledger, entrypoint);
    const chain = (routeChains.get(entrypoint.id) ?? [])
      .sort((a, b) => a.order - b.order || cmp(a.id, b.id))
      .map((step) => nodes.get(step.id))
      .filter(Boolean);
    const reachable = new Set(chain.map((node) => node.id));
    for (const step of chain)
      for (const id of reachedBy(graph, step.id, shared)) reachable.add(id);
    const mutating = [...reachable]
      .map((id) => nodes.get(id))
      .filter((node) => node?.kind === 'effect' && node.meta?.effectType === 'db_write');
    guardBoundaryFacts(ledger, graph, entrypoint, chain, mutating);
    occurrenceFacts(ledger, entrypoint, reachable, occurrences);
  }

  providerLinkageFacts(ledger, graph, providerLinkages);

  return { ledger, facts: ledgerFacts(ledger), summary: summarizeLedger(ledger) };
}
