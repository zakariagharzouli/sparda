// ubg/translate.js — syntax-specific facts → the language-agnostic UBG.
// After this file, "Express" and "Next.js" no longer exist: there are only
// entrypoints, guards, logic, effects and state, wired by control_flow,
// data_flow, gate and mutation edges. The translation contract:
//
//   entrypoint ──control_flow(0)──▶ mw₁ ──cf(1)──▶ … ──cf(n)──▶ handler
//   entrypoint ──data_flow{request schema}──▶ handler
//   guard mwᵢ  ──gate{requirement}──▶ handler        (must pass to reach)
//   handler    ──control_flow(k)──▶ effectₖ           (body source order)
//   effect(db_write) ──mutation{op}──▶ state          (linker resolves table)
//   state ──data_flow{rows}──▶ effect(db_read)
//   handler ──control_flow──▶ called helper logic     (local call graph)
import {
  addEdge,
  addNode,
  cmp,
  createGraph,
  effectId,
  entrypointId,
  guardId,
  logicId,
  makeEdge,
  makeNode,
  stateId,
} from './schema.js';
import { isGuardLike, isNoOpGuard, scanFunction } from './extract.js';
import { matcherCovers } from './nextjs.js';
import { certifyConservation, graphFactInventory } from './conservation.js';

// A global middleware only guards a route whose path its Next `config.matcher`
// actually covers. No matcher → every path (Next default). A matcher present but
// unresolved, or one that resolves to "not covered", → do NOT attribute (an
// unproven guard is never fabricated — SOUNDNESS.md, no false PROVEN).
function middlewareAppliesTo(mw, route) {
  // Sequential scope (E-061): the framework reads setup top-to-bottom — a use()
  // declared AFTER a route never runs for that route, so crediting it would fabricate
  // protection out of thin air. Comparable only when BOTH sides carry an order stamp
  // (one extractor run); an unstamped side keeps the prior semantics. Monotone in the
  // safe direction: this check can only WITHHOLD credit, never add it.
  if (mw.order != null && route.order != null) {
    if (mw.order > route.order) return false;
    // Same mount position → compare the position WITHIN the file. Every route in a
    // mounted router shares the mount's order, so without this a `router.use(auth)`
    // written at the bottom of that file would be credited to the routes above it.
    if (
      mw.order === route.order &&
      mw.orderIn != null &&
      route.orderIn != null &&
      mw.orderIn > route.orderIn
    )
      return false;
  }
  // Path scope (Z6): `app.use('/api', mw)` runs ONLY under that prefix. Crediting it
  // beyond the prefix fabricates protection — the Express twin of the Next matcher sin
  // (E-NEXT-MW). Express matches the prefix itself and anything below it, never a mere
  // string prefix of a longer segment (`/api` does not cover `/apikeys`).
  if (mw.pathPrefix && !pathCoveredBy(mw.pathPrefix, route.path)) return false;
  if (mw.role !== 'middleware' || mw.matcherPatterns == null) {
    return !mw.matcherUnresolved; // no matcher = all paths; unresolved matcher = abstain
  }
  return matcherCovers(mw.matcherPatterns, route.path) === true;
}

// RFC 9110 §9.2.1 safe methods: they are not expected to change state, so an
// entrypoint using one carries no mutation obligation. This is a SET, not
// `method !== 'get'`, because the extractors now model OPTIONS/HEAD/TRACE too —
// and reading a CORS pre-flight handler as a mutation would flood every real app
// with false criticals. A safe method that DOES write still surfaces: the write
// itself is an effect, and O1 fires on the effect, not on the verb.
const SAFE_METHOD = new Set(['get', 'head', 'options', 'trace']);

// Express mount semantics: `/api` covers `/api` and `/api/**`, but not `/apikeys`.
function pathCoveredBy(prefix, routePath) {
  if (routePath === prefix) return true;
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return routePath.startsWith(base);
}

// Is this chain step / helper a REAL guard? Named or deny-bodied like a guard, and
// NOT a visible no-op pass-through (a disabled `(req,res,next)=>next()` guards nothing).
// `verified` = we SAW a deny path (body visible + throw/deny-status/next(err)); an opaque
// middleware/decorator (fn:null) is trusted by name but marked unverified — honest either way.
function guardFacts(name, scan, fn) {
  const isGuard = isGuardLike(name, scan) && !isNoOpGuard(fn);
  return { isGuard, verified: Boolean(scan?.guardSignals?.deniesWithStatus) };
}

export function translate({
  framework,
  routes,
  globalMiddlewares,
  helpers,
  tables,
  // Per-owner effect OCCURRENCES, collected as bodies are attached. The UBG
  // effect node is a canonical OPERATION — two routes reaching the same DAO line
  // legitimately share it, and re-keying it would merge or split effects across
  // every downstream count and baseline (E-100). The occurrence is the other
  // half: what THIS body proved about that operation, before dedup collapses it.
  occurrences = [],
}) {
  const graph = createGraph({ framework });
  const scanCache = new Map(); // nodeId -> scan result (a body is scanned once)
  const expanded = new Set(); // nodeIds whose body effects are already attached
  const helperFacts = new Map();
  const usedGlobalMiddlewares = new Set();
  const sourceFacts = {
    routes: sourceFactIds(routes, 'route'),
    globalMiddlewares: sourceFactIds(globalMiddlewares, 'middleware'),
    helpers: sourceFactIds(helpers, 'helper'),
    tables: sourceFactIds(tables, 'table'),
  };

  // ---- state layer: declared truth from SQL, one node per table
  for (const t of tables) {
    addNode(
      graph,
      makeNode(
        stateId('sql', t.name),
        'state',
        `table ${t.name}`,
        { file: t.sourceFile, line: t.sourceLine },
        {
          store: 'sql',
          table: t.name,
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.type,
            sqlType: c.sqlType,
            nullable: c.nullable,
            pk: c.pk,
          })),
          // SBIR v1.1 §2.1/§2.3 — declared truth travels with the state node
          ...(t.invariants?.length ? { invariants: t.invariants } : {}),
          ...(t.references?.length ? { references: t.references } : {}),
          // Prisma @@map: code speaks the model name, SQL speaks the mapped
          // table — the linker must answer to both
          ...(t.aliases?.length ? { aliases: t.aliases } : {}),
        },
      ),
    );
  }

  // ---- helper logic layer: every top-level function seen in scanned files.
  // Most will be reached via call edges; the rest is exactly what
  // DeadPathElimination exists to remove.
  const helperByName = new Map(); // name -> nodeId (first wins, sorted for determinism)
  const sortedHelpers = [...helpers].sort(
    (a, b) =>
      cmp(a.sourceFile, b.sourceFile) ||
      a.sourceLine - b.sourceLine ||
      cmp(a.name, b.name),
  );
  for (const h of sortedHelpers) {
    // extractors on non-JS runtimes (FastAPI) pre-compute the scan — the
    // microscope only runs when we hold an actual babel node
    const scan = h.scan ?? scanFunction(h.fn);
    // E-042: a CALLED helper (role `function`) is a guard ONLY by a PROVEN deny, never by
    // name. Name-trust belongs to explicit chain steps (a middleware you SEE gate the
    // route — `@Authenticated`, `requireAuth`); a function you merely call that happens to
    // be named `mapUserAdmin` / `isAdmin` / `sessionStore` is logic, not a guard. Trusting
    // its name would let it fabricate a gate and hide a real finding (SOUNDNESS Direction 2).
    const denies = Boolean(scan.guardSignals?.deniesWithStatus);
    const gf = { isGuard: denies && !isNoOpGuard(h.fn), verified: denies };
    const kind = gf.isGuard ? 'guard' : 'logic';
    const id =
      kind === 'guard'
        ? guardId(h.sourceFile, h.name, h.sourceLine)
        : logicId(h.sourceFile, h.name, h.sourceLine);
    addNode(
      graph,
      makeNode(
        id,
        kind,
        h.name,
        { file: h.sourceFile, line: h.sourceLine },
        {
          role: 'function',
          async: scan.async,
          ...(kind === 'guard'
            ? { guardType: guardTypeOf(h.name, scan), verified: gf.verified }
            : {}),
        },
      ),
    );
    scanCache.set(id, scan);
    if (!helperByName.has(h.name)) helperByName.set(h.name, id);
    helperFacts.set(sourceFacts.helpers.get(h), id);
  }

  // ---- routes: the behavior spine
  for (const route of routes) {
    translateRoute(
      graph,
      route,
      globalMiddlewares,
      scanCache,
      helperByName,
      expanded,
      usedGlobalMiddlewares,
      occurrences,
    );
  }

  // Fabric F1: translation is the first boundary where source facts become
  // graph facts.  The certificate makes each source item either represented,
  // explicitly merged, or explicitly lost with a reason — never absent by
  // accident.  The graph inventory is listed as introduced output because it
  // has no source-language identity before this boundary.
  graph.meta.conservation = {
    translate: translationCertificate({
      graph,
      routes,
      globalMiddlewares,
      helpers,
      tables,
      helperFacts,
      usedGlobalMiddlewares,
      sourceFacts,
    }),
  };

  return graph;
}

function translateRoute(
  graph,
  route,
  globalMiddlewares,
  scanCache,
  helperByName,
  expanded,
  usedGlobalMiddlewares,
  occurrences = [],
) {
  const epId = entrypointId(route.method, route.path);
  addNode(
    graph,
    makeNode(
      epId,
      'entrypoint',
      `${route.method.toUpperCase()} ${route.path}`,
      { file: route.sourceFile, line: route.sourceLine },
      {
        method: route.method,
        path: route.path,
        inputs: route.params,
        mutating: !SAFE_METHOD.has(route.method.toLowerCase()),
        ...(route.description ? { description: route.description } : {}),
      },
    ),
  );

  // global middlewares run before route-level ones — same chain, lower order —
  // but only those whose matcher actually covers this route's path (E-NEXT-MW)
  const applicable = globalMiddlewares.filter((mw) => middlewareAppliesTo(mw, route));
  for (const middleware of applicable) usedGlobalMiddlewares.add(middleware);
  const fullChain = [...applicable, ...route.chain];
  let prevId = epId;
  let order = 0;
  const chainNodes = [];

  for (const step of fullChain) {
    const { id: stepId, scan } = ensureChainNode(graph, step, scanCache);
    chainNodes.push({ id: stepId, step, scan });
    // chain edges carry their route: a middleware shared by N routes fans out
    // to N handlers, but a request only ever walks ONE of those edges —
    // per-entrypoint traversals filter on meta.route to stay leak-free
    addEdge(
      graph,
      makeEdge('control_flow', prevId, stepId, { order: order++, route: epId }),
    );
    prevId = stepId;
  }

  const handlerEntry = chainNodes.length > 0 ? chainNodes[chainNodes.length - 1] : null;
  if (!handlerEntry) return; // entrypoint with no resolvable chain — dead-path pass reaps it

  // SBIR v1.1 §2.1 — validator seen in the handler body (zod) or enforced by
  // the framework (FastAPI Pydantic): recorded as a signal, never decomposed
  if (handlerEntry.scan?.validatesInput) graph.nodes.get(epId).meta.inputValidated = true;

  // request data flows straight to the handler (middlewares see it too, but
  // the handler is where the schema lands and returns are produced)
  addEdge(
    graph,
    makeEdge('data_flow', epId, handlerEntry.id, {
      via: 'request',
      schema: Object.fromEntries(route.params.map((p) => [p.name, p.type])),
    }),
  );

  // every guard on the chain gates the handler
  for (const cn of chainNodes) {
    const node = graph.nodes.get(cn.id);
    if (node.kind === 'guard' && cn.id !== handlerEntry.id) {
      addEdge(
        graph,
        makeEdge('gate', cn.id, handlerEntry.id, { requirement: node.label }),
      );
    }
  }

  // Attach effects from EVERY chain step that has a body, not only the terminal one.
  // The near-universal directus/Express pattern puts the business logic in a MIDDLEWARE
  // slot and a response-formatter (`respond`) last — `router.get(path, …, handler,
  // respond)` — so the real DB work lives one slot before the end. All chain steps are
  // control-flow-reachable from the entrypoint, so the prover sees them wherever they sit.
  for (const cn of chainNodes) {
    if (cn.scan)
      attachBody(graph, cn.id, cn.scan, helperByName, scanCache, expanded, occurrences);
  }

  // G1 (O7/BOLA only): if any step on this route asserts caller-ownership at a call site
  // (`getXOrThrow({ workspaceId: workspace.id })`), the route scopes its objects to the
  // caller — even when the assertion lives in an imported helper SPARDA doesn't expand.
  // Advisory-only signal: it silences the false BOLA, never touches a hard rule.
  if (chainNodes.some((cn) => cn.scan?.ownerAsserted))
    graph.nodes.get(epId).meta.ownerAsserted = true;

  // G2 (guard taxonomy): credential-check signals from the route's own bodies. Advisory-only —
  // they can downgrade an UNGUARDED critical to an advisory, never verify a guard.
  if (chainNodes.some((cn) => cn.scan?.credentialSignals?.verifyCall))
    graph.nodes.get(epId).meta.credentialVerify = true;
  if (chainNodes.some((cn) => cn.scan?.credentialSignals?.denies4xxOrThrows))
    graph.nodes.get(epId).meta.credentialGates = true;
  if (chainNodes.some((cn) => cn.scan?.credentialSignals?.redirects))
    graph.nodes.get(epId).meta.credentialRedirects = true;
}

function translationCertificate({
  graph,
  routes,
  globalMiddlewares,
  helpers,
  tables,
  helperFacts,
  usedGlobalMiddlewares,
  sourceFacts,
}) {
  const before = [];
  const after = [];
  const merged = [];
  const lost = [];
  const representedRoutes = new Map();
  const representedTables = new Map();

  for (const route of routes) {
    const id = sourceFacts.routes.get(route);
    before.push(id);
    const graphId = entrypointId(route.method, route.path);
    if (!graph.nodes.has(graphId))
      throw new Error(`Fabric conservation: translation did not create ${id}`);
    const prior = representedRoutes.get(graphId);
    if (prior) {
      merged.push({
        id,
        into: prior,
        reason: 'same route identity maps to one UBG entrypoint',
      });
    } else {
      representedRoutes.set(graphId, id);
      after.push(id);
    }
  }

  for (const table of tables) {
    const id = sourceFacts.tables.get(table);
    before.push(id);
    const graphId = stateId('sql', table.name);
    if (!graph.nodes.has(graphId))
      throw new Error(`Fabric conservation: translation did not create ${id}`);
    const prior = representedTables.get(graphId);
    if (prior) {
      merged.push({
        id,
        into: prior,
        reason: 'same schema identity maps to one UBG state',
      });
    } else {
      representedTables.set(graphId, id);
      after.push(id);
    }
  }

  for (const helper of helpers) {
    const id = sourceFacts.helpers.get(helper);
    before.push(id);
    if (!helperFacts.has(id))
      throw new Error(`Fabric conservation: translation did not create ${id}`);
    after.push(id);
  }

  for (const middleware of globalMiddlewares) {
    const id = sourceFacts.globalMiddlewares.get(middleware);
    before.push(id);
    if (usedGlobalMiddlewares.has(middleware)) after.push(id);
    else {
      lost.push({
        id,
        reason:
          'global middleware applies to no extracted route under its declared scope',
      });
    }
  }

  const graphFacts = graphFactInventory(graph);
  return certifyConservation({
    pass: 'translate',
    factsBefore: before,
    factsAfter: [...after, ...graphFacts.map((fact) => fact.id)],
    nodesIntroduced: graphFacts,
    nodesMerged: merged,
    informationLost: lost,
    invariantsPreserved: ['every-source-fact-is-represented-merged-or-declared-lost'],
  });
}

const sourceLoc = (value) =>
  `${value.sourceFile ?? '<unknown>'}:${value.sourceLine ?? 0}`;
function sourceFactIds(values, kind) {
  const seen = new Map();
  const base = (value) => {
    if (kind === 'route')
      return `${value.method.toUpperCase()}:${value.path}:${sourceLoc(value)}`;
    if (kind === 'table') return `${value.name}:${sourceLoc(value)}`;
    return `${value.name}:${sourceLoc(value)}`;
  };
  return new Map(
    values.map((value) => {
      const id = base(value);
      const ordinal = seen.get(id) ?? 0;
      seen.set(id, ordinal + 1);
      return [value, `source:${kind}:${id}:${ordinal}`];
    }),
  );
}

// A chain step (middleware or handler) becomes a guard or logic node.
function ensureChainNode(graph, step, scanCache) {
  const scan = step.scan ?? scanFunction(step.fn);
  const gf = guardFacts(step.name, scan, step.fn);
  const kind = gf.isGuard && step.role !== 'handler' ? 'guard' : 'logic';
  const id =
    kind === 'guard'
      ? guardId(step.sourceFile, step.name, step.sourceLine)
      : logicId(step.sourceFile, step.name, step.sourceLine);
  const existing = graph.nodes.get(id);
  if (existing) {
    // helper already registered — upgrade role if this use is more specific
    if (step.role === 'handler') existing.meta.role = 'handler';
    const cachedScan = scanCache.get(id) ?? scan;
    if (step.role === 'handler' && cachedScan.returnShapes.length)
      existing.meta.returnShapes = cachedScan.returnShapes;
    return { id, scan: cachedScan };
  }
  // opaque = SPARDA holds NO body for this step (fn:null and no precomputed scan) —
  // a handler/middleware it registered by name but could not read. The blindspot
  // ledger uses this to tell "read and empty" apart from "couldn't read".
  const opaque = !step.fn && !step.scan;
  addNode(
    graph,
    makeNode(
      id,
      kind,
      step.name,
      { file: step.sourceFile, line: step.sourceLine },
      {
        role: step.role,
        async: scan.async,
        ...(opaque ? { opaque: true } : {}),
        ...(kind === 'guard'
          ? { guardType: guardTypeOf(step.name, scan), verified: gf.verified }
          : {}),
        ...(step.role === 'handler' && scan.returnShapes.length
          ? { returnShapes: scan.returnShapes }
          : {}),
      },
    ),
  );
  scanCache.set(id, scan);
  return { id, scan };
}

// handler body → effect nodes (source order) + call edges into helper logic
function attachBody(
  graph,
  ownerId,
  scan,
  helperByName,
  scanCache,
  expanded,
  occurrences = [],
) {
  if (expanded.has(ownerId)) return; // one body, one expansion
  expanded.add(ownerId);
  const owner = graph.nodes.get(ownerId);

  // G2 propagation (advisory-only): a body that itself refuses on a credential check — throw/4xx,
  // a verify call, or an OAuth redirect — carries that refusal AT ITS OWN node. This is why the
  // first-run and API-key gates read as false criticals: their refusal lives in an imported/DI
  // service method that has no effect of its own, so the signal never rode the entrypoint's direct
  // middleware chain. Tagging the reached body lets the prover see the mechanism through the call
  // graph. Reading this tag can only DOWNGRADE a critical to advisory — never prove, never silence,
  // never fabricate a guard. Tagged once, on first expansion; the node is route-independent.
  if (owner) {
    // Node Semantic Kernel: the continuations this body (and everything merged
    // into it) runs later. Deterministically ordered so the graph stays
    // byte-identical run to run.
    if (scan.continuations?.length)
      owner.meta.continuations = [...scan.continuations]
        .sort(
          (a, b) =>
            a.line - b.line || cmp(a.form, b.form) || cmp(a.symbol ?? '', b.symbol ?? ''),
        )
        .filter(
          (c, i, all) =>
            i === 0 ||
            c.line !== all[i - 1].line ||
            c.form !== all[i - 1].form ||
            c.symbol !== all[i - 1].symbol,
        );
    if (scan.credentialSignals?.denies4xxOrThrows) owner.meta.bodyDenies = true;
    if (scan.credentialSignals?.verifyCall) owner.meta.bodyVerifies = true;
    if (scan.credentialSignals?.redirects) owner.meta.bodyRedirects = true;
  }

  let order = 0;
  let ordinal = 0;
  const created = []; // effects of THIS body — compensation pairs live here
  for (const eff of scan.effects) {
    // E-099 — `eff.line` is a line in the body that PRODUCED the effect, and the resolver
    // merges bodies from other files upward (controller → service → repository). The
    // declaring file rides with the effect (`stampDeclaringFile`); the owner's file is the
    // fallback for a body scanned outside the resolver, where the two are the same file.
    // The node ID deliberately stays keyed on the OWNER's file: it is the per-owner dedup
    // identity every downstream count and snapshot is built on, and re-keying it would
    // silently merge effects across owners — a different change, with a different proof.
    const effFile = eff.file ?? owner.loc.file;
    let id = effectId(eff.effectType, owner.loc.file, eff.line, ordinal++);
    // A shared service method reached under two different symbolic bindings
    // (`this.knex(this.collection)` as `:collection` vs `directus_activity`) lands two
    // DIFFERENT effects on the same source line. Node ids are content-identity, so bump
    // the ordinal until free rather than let the second effect collide away. Same-target
    // effects still share their node (the intended cross-route dedup).
    const targetOf = (m) => m.table ?? m.target ?? null;
    while (graph.nodes.has(id) && targetOf(graph.nodes.get(id).meta) !== targetOf(eff))
      id = effectId(eff.effectType, owner.loc.file, eff.line, ordinal++);
    // Whether this operation was ALREADY in the graph decides whether the block
    // below is a merge or a no-op. Read before `addNode`, which returns the
    // existing node and would otherwise make every first creation look like a
    // reuse — and then re-add fields the meta construction deliberately omitted.
    const alreadyPresent = graph.nodes.has(id);
    addNode(
      graph,
      makeNode(
        id,
        'effect',
        effectLabel(eff),
        { file: effFile, line: eff.line },
        {
          effectType: eff.effectType,
          ...(eff.op ? { op: eff.op } : {}),
          ...(eff.table ? { table: eff.table } : {}),
          // symbolic table (`:collection`): a request-derived target, resolved as a
          // rule, not a literal — carried so the blindspot ledger doesn't flag it opaque
          ...(eff.symbolic ? { symbolic: true } : {}),
          // opaque persistence write (ADR-068): a proven-handle call with an unknown method/table
          // — fires the guard obligation (O1) with no table, never O2/O3 precision.
          ...(eff.opaque ? { opaque: true } : {}),
          // …and WHY it is opaque: a computed member (`prisma.note[OP]()`) whose method
          // name is not statically readable. Carried so the ledger can say which kind of
          // blindness it is, rather than lumping it with an unknown-but-named method.
          ...(eff.dynamicMember ? { dynamicMember: true } : {}),
          ...(eff.target ? { target: eff.target } : {}),
          ...(eff.driver ? { driver: eff.driver } : {}),
          ...(eff.httpMethod ? { httpMethod: eff.httpMethod } : {}),
          // literal column values (SBIR v1.2) — StateMachineInference fuel
          ...(eff.sets ? { sets: eff.sets } : {}),
          ...(eff.where ? { where: eff.where } : {}),
          ...(eff.inserts ? { inserts: eff.inserts } : {}),
          // taint: the write's payload is provably request-derived (ADR-P1 foothold).
          // Advisory provenance — it enriches an UNGUARDED_MUTATION, never a finding of
          // its own (a per-function under-approximation can't see service-layer validation).
          ...(eff.tainted ? { tainted: true } : {}),
          // DataSource → DbEffect (Node Semantic Kernel). Which request surfaces
          // reached the FILTER and which reached the STORED DATA, kept apart
          // because they answer different questions: a client-chosen filter is an
          // object-scope question, a client-chosen payload a validation one.
          // Provenance only — neither ever proves or disproves a guard.
          // TAPP-0 rule 13: the field is ALWAYS present, because `null` (not
          // measurable here) and `[]` (inspected, none found) are different
          // answers and an absent key collapses them into one.
          ...(eff.filterOrigins !== undefined
            ? { filterOrigins: eff.filterOrigins }
            : {}),
          ...(eff.dataOrigins !== undefined ? { dataOrigins: eff.dataOrigins } : {}),
          ...(eff.filterTainted ? { filterTainted: true } : {}),
          // guard-dominance (kills the C2 false PROVEN): this mutation runs BEFORE a guard that
          // follows it on the same body spine — i.e. it executes without having passed that check.
          ...(eff.bypassesGuard ? { bypassesGuard: true } : {}),
          // object-scope provenance (ADR-058 B): the query targets a bare `id`, and whether
          // it is scoped to the caller. A route with an idScoped access and NO ownerScoped
          // access anywhere on its resolved path is a BOLA candidate (advisory).
          ...(eff.idScoped ? { idScoped: true } : {}),
          ...(eff.ownerScoped ? { ownerScoped: true } : {}),
          // SBIR v1.1 §2.2 — transaction scope id is file-qualified here, where the
          // declaring file is known. It qualifies on the EFFECT's file, not the owner's:
          // `txLine` is a line in the body that opened the scope, so owner-qualifying it
          // made two different services' transactions that happen to start on the same
          // line collapse into one id — O3 then read a multi-table write as atomic when
          // nothing joined the two. Splitting them can only ADD a finding, never remove one.
          ...(eff.txLine != null
            ? {
                transaction: {
                  id: `tx:${effFile}:${eff.txLine}`,
                  isolation: eff.txIsolation ?? 'default',
                },
                onFailure: { action: 'rollback' },
              }
            : {}),
        },
      ),
    );
    // A shared node keeps the FIRST body's meta (`addNode` returns the existing
    // one). That is contamination: whichever route compiled first would decide
    // what every other route "proved" about the same operation. Reusing a node
    // therefore takes the MEET of the safety flags — a scope holds only if EVERY
    // contributing body proved it — and the UNION of the request origins, since
    // one more client-chosen origin can only widen an advisory. Both directions
    // are the safe one.
    const reused = alreadyPresent ? graph.nodes.get(id) : null;
    if (reused && reused.meta.effectType === eff.effectType) {
      if (!eff.ownerScoped) delete reused.meta.ownerScoped;
      if (!eff.idScoped) delete reused.meta.idScoped;
      const union = (key, incoming) => {
        const seen = new Map(
          [...(reused.meta[key] ?? []), ...(incoming ?? [])].map((o) => [
            `${o.origin}:${o.name ?? '*'}`,
            o,
          ]),
        );
        if (seen.size)
          reused.meta[key] = [...seen.entries()]
            .sort((a, b) => cmp(a[0], b[0]))
            .map(([, o]) => o);
      };
      union('filterOrigins', eff.filterOrigins);
      union('dataOrigins', eff.dataOrigins);
    }
    addEdge(graph, makeEdge('control_flow', ownerId, id, { order: order++ }));
    // What THIS body proved, recorded before the shared node erases it. Two
    // routes calling the same DAO method carry different taint seeds, so their
    // scans differ — and everything that difference established used to be lost
    // the moment the second one found the node id already taken.
    if (eff.effectType === 'db_read' || eff.effectType === 'db_write')
      occurrences.push({
        owner: ownerId,
        effect: id,
        file: effFile,
        line: eff.line,
        access: eff.effectType === 'db_write' ? 'write' : 'read',
        op: eff.op ?? null,
        table: eff.table ?? null,
        symbolicTarget: eff.symbolic === true,
        filter: eff.where ?? null,
        // `?? null`, never `?? []`: an unmeasured role must not arrive at the
        // occurrence looking like an inspected-and-empty one.
        filterOrigins: eff.filterOrigins ?? null,
        dataOrigins: eff.dataOrigins ?? null,
        // TAPP-1 rides on the OCCURRENCE, never on the shared effect node above:
        // the node is one canonical operation and the path is what ONE route's
        // body proved about it. Unioning them onto the node — the way the safety
        // flags have to be — would be the provenance bleed the occurrence exists
        // to prevent.
        filterPaths: eff.filterPaths ?? null,
        dataPaths: eff.dataPaths ?? null,
        filterRequestDerived: eff.filterTainted === true,
        dataRequestDerived: eff.tainted === true,
        ownerScoped: eff.ownerScoped === true,
        idScoped: eff.idScoped === true,
      });
    created.push({ id, eff });
  }

  // SBIR v1.1 §2.2 — compensating pathways: a mutating catch-effect undoes
  // every mutating try-effect of its group
  const MUTATING = new Set(['db_write', 'http_call', 'fs_write']);
  for (const c of created) {
    if (c.eff.catchOf == null || !MUTATING.has(c.eff.effectType)) continue;
    for (const t of created) {
      if (t.eff.tryId !== c.eff.catchOf || !MUTATING.has(t.eff.effectType)) continue;
      addEdge(graph, makeEdge('compensation', c.id, t.id, { reason: 'catch-handler' }));
      const target = graph.nodes.get(t.id);
      const by = new Set([...(target.meta.onFailure?.by ?? []), c.id]);
      target.meta.onFailure = { action: 'compensate', by: [...by].sort() };
    }
  }

  for (const call of scan.calls) {
    const calleeId = helperByName.get(call.name);
    if (!calleeId || calleeId === ownerId) continue;
    addEdge(graph, makeEdge('control_flow', ownerId, calleeId, { order: order++ }));
    // called helpers expand their own bodies (bounded: the set prevents re-entry)
    const calleeScan = scanCache.get(calleeId);
    if (calleeScan)
      attachBody(
        graph,
        calleeId,
        calleeScan,
        helperByName,
        scanCache,
        expanded,
        occurrences,
      );
  }
}

function effectLabel(eff) {
  if (eff.effectType === 'db_write') return `db ${eff.op} ${eff.table ?? '?'}`;
  if (eff.effectType === 'db_read') return `db ${eff.op ?? 'read'} ${eff.table ?? '?'}`;
  if (eff.effectType === 'http_call') return `http ${eff.target}`;
  return `${eff.effectType} ${eff.target ?? ''}`.trim();
}

function guardTypeOf(name, scan) {
  if (scan?.guardSignals.deniesWithStatus) return 'denies-unauthorized';
  return /role|admin|permission|acl/i.test(name ?? '')
    ? 'authorization'
    : 'authentication';
}
