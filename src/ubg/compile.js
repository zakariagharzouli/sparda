// ubg/compile.js — the orchestrator: codebase in, UBG out.
// detect → extract (framework routes + SQL schemas) → translate → link →
// optimize → canonicalize. 100% local, zero network, zero LLM, deterministic:
// the only inputs are the bytes of the source tree, the only output is the
// graph plus an honest report of everything the static eye could NOT see.
import { detectStack } from '../detect.js';
import { clearModuleCache, configurationResolution } from './extract.js';
import { extractExpress } from './express.js';
import { extractNest } from './nestjs.js';
import { extractMedusa } from './medusa.js';
import { extractStrapi } from './strapi.js';
import { extractNext } from './nextjs.js';
import { extractFastAPI } from './fastapi.js';
import { extractOpenAPI } from './openapi.js';
import { parseSqlSchemas } from './sql.js';
import { parsePrismaSchemas } from './prisma.js';
import { translate } from './translate.js';
import { linkDataFlow } from './link.js';
import { optimize } from './pipeline.js';
import { validateGraph } from './schema.js';
import { serializeGraph, sourceHashOf, writeGraph } from './serialize.js';
import { structuralCoverage } from './semantic-facts.js';
import { canonicalizeGraph } from './schema.js';
import { createLedger, certifyKernelConservation, ledgerFacts } from './kernel/facts.js';
import { liftKernelFacts } from './kernel/lift.js';
import { attachBoundaries } from './kernel/attach.js';
import { CONTRACTS } from './kernel/contracts.js';
import { checkAuthorizationPolicy } from './authorization-policy.js';
import { attachIdentityRiskEvidence } from './identity-risk.js';
import { checkSourceAuthorization } from './source-authorization.js';

export function compileUBG(
  cwd,
  {
    write = true,
    out = null,
    optimizePasses = true,
    openapi = null,
    budgetMs,
    authorizationPolicy,
    sourceAuthorizationPolicy,
  } = {},
) {
  clearModuleCache(); // each compile run parses fresh — no stale-file ghosts

  // --openapi: the universal lowering — no framework detection, ANY backend
  // that carries a spec enters the graph (Go, Java, Rails, .NET, whatever)
  const stack = openapi
    ? {
        framework: 'openapi',
        entryFile: openapi,
        detection: {
          evidence: [
            { kind: 'explicit-openapi', file: openapi, value: 'user-supplied spec' },
          ],
          alternativeCandidates: [],
          contradictions: [],
          coverage: {
            framework: 'declared',
            entry: 'declared',
            entryCandidates: 1,
            selected: openapi,
            complete: true,
          },
          blindspots: [],
        },
      }
    : detectStack(cwd);
  // The Node Semantic Kernel ledger. Extraction records UnknownBoundary facts
  // into it as the interprocedural walk stops; lifting derives the other four
  // kinds from the compiled graph afterwards.
  const kernel = createLedger();
  const extractors = {
    express: () => extractExpress(cwd, stack.entryFile, { budgetMs, kernel }),
    nestjs: () => extractNest(cwd, stack.entryFile, { kernel }),
    medusa: () => extractMedusa(cwd, stack.entryFile),
    strapi: () => extractStrapi(cwd, stack.entryFile),
    nextjs: () => extractNext(cwd, stack.entryFile),
    fastapi: () => extractFastAPI(cwd, stack.entryFile, stack.pythonCmd),
    // Flask reuses the FastAPI (Python) extractor — same stdlib-ast walk, Flask route
    // discovery folded in (Flask()/Blueprint/@app.route/register_blueprint/@login_required).
    flask: () => extractFastAPI(cwd, stack.entryFile, stack.pythonCmd),
    openapi: () => extractOpenAPI(cwd, stack.entryFile),
  };
  if (!extractors[stack.framework]) {
    throw Object.assign(
      new Error(`UBG compiler has no lowering for ${stack.framework} yet.`),
      { code: 'USER' },
    );
  }
  const extracted = extractors[stack.framework]();

  const sql = parseSqlSchemas(cwd);
  const prisma = parsePrismaSchemas(cwd);
  // DDL beats ORM on a name collision — the database is the closer truth
  const sqlNames = new Set(sql.tables.map((t) => t.name));
  const tables = [...sql.tables, ...prisma.tables.filter((t) => !sqlNames.has(t.name))];

  const effectOccurrences = [];
  const graph = translate({
    occurrences: effectOccurrences,
    framework: stack.framework,
    routes: extracted.routes,
    globalMiddlewares: extracted.globalMiddlewares,
    helpers: extracted.helpers,
    tables,
  });
  validateGraph(graph);

  const linkReport = linkDataFlow(graph);
  validateGraph(graph);

  const passReports = optimizePasses ? optimize(graph) : [];

  // Fabric F2: every lowering already returns the structural surface it
  // consumed (`routes`, declared unknown handlers, and skips).  Compare that
  // surface to the final graph rather than trusting an extractor to remember
  // to self-report what it lost.  A route reaped by a later pass is therefore
  // unmeasured even though the extractor initially saw it.
  const semanticCoverage = structuralCoverageFor(stack.framework, extracted, graph);

  // Node Semantic Kernel. Lifting reads the CANONICAL graph — the same bytes
  // every downstream consumer grades — so a kernel fact can never describe a
  // program the prover did not see. The facts extraction already recorded
  // (UnknownBoundary) are carried in, and conservation proves none was dropped
  // on the way: `before` is what extraction produced, `after` is the full ledger.
  const extractedFacts = ledgerFacts(kernel);
  // The edge from a body to the stop it made. Stamped BEFORE lifting and before
  // canonicalization, so the boundary travels with the node every downstream
  // consumer already walks — the route-reachability question ("does this route
  // depend on something SPARDA could not read?") then costs nothing new.
  const boundaryAttachment = attachBoundaries(graph, kernel);
  const lifted = liftKernelFacts(canonicalizeGraph(graph), {
    ledger: kernel,
    occurrences: effectOccurrences,
    // Nest static direct provider V1 (ADR-102). Lifted here rather than emitted in
    // the lowering because the fact names the EFFECT NODE when one exists, and the
    // effect nodes only exist once the graph is built.
    providerLinkages: extracted.providerLinkages ?? [],
  });
  const kernelConservation = certifyKernelConservation({
    pass: 'lift',
    before: extractedFacts,
    after: lifted.facts,
  });

  const compilationFiles = [
    ...extracted.scannedFiles,
    ...tables.map((t) => t.sourceFile),
    ...configurationResolution(cwd).flatMap((configuration) => configuration.files),
  ];
  graph.meta = {
    ...graph.meta,
    framework: stack.framework,
    entry: stack.entryFile,
    sourceHash: sourceHashOf(cwd, compilationFiles),
    semanticCoverage: semanticCoverage.coverage,
    detection: stack.detection,
  };

  attachIdentityRiskEvidence(graph, lifted.facts);
  const structuralSkips = semanticCoverage.unmeasured
    .map((fact) => semanticCoverage.unmeasuredMeta.get(fact.id))
    .filter((fact) => fact?.origin === 'route')
    .map((fact) => ({
      reason: `unmeasured structural route: ${fact.method.toUpperCase()} ${fact.path} was parsed but did not survive into the final UBG`,
      file: fact.source.file,
      line: fact.source.line,
      risk: 'high',
    }));

  const report = {
    configurationResolution: configurationResolution(cwd),
    framework: stack.framework,
    entry: stack.entryFile,
    detection: stack.detection,
    routes: extracted.routes.length,
    tables: tables.length,
    ...(prisma.tables.length ? { prismaTables: prisma.tables.length } : {}),
    link: linkReport,
    passes: passReports,
    skipped: [
      ...extracted.skipped,
      ...sql.skipped,
      ...prisma.skipped,
      // A GUESSED entry point is a premise problem, not a parsing one: if the search
      // picked the wrong file, every route, guard and verdict below is about another
      // program. Measured on the parse-server repository, where the fallback chose a
      // benchmark harness. The doubt is declared at high risk so it bars PROVEN, and
      // the rejected candidates are named so a human can settle it in one look.
      ...(stack.entryCandidates?.length > 1
        ? [
            {
              reason: `entry point GUESSED: ${stack.entryFile} was chosen among ${stack.entryCandidates.length} files that create an Express app (${stack.entryCandidates.slice(0, 4).join(', ')}${stack.entryCandidates.length > 4 ? ', …' : ''}) — if it is the wrong one, everything below describes a different program`,
              file: stack.entryFile,
              risk: 'high',
            },
          ]
        : []),
      ...structuralSkips,
    ],
    // registrations SPARDA saw but could not bind statically (computed verbs,
    // Reflect.apply, …) — each already carries a high-risk skipped twin, this is
    // the structured object for tooling
    ...(extracted.unknownHandlers?.length
      ? { unknownHandlers: extracted.unknownHandlers }
      : {}),
    // The kernel travels in the REPORT rather than in the graph: the graph is
    // hashed by the behavior fingerprint and pinned by the corpus snapshot, and
    // a diagnostic ledger has no business moving either. Same rule PDE follows.
    kernel: {
      ...lifted.summary,
      conservation: kernelConservation,
      // The two populations, side by side and never averaged: stops that reached
      // a body the graph carries (and can therefore gate a route), and stops that
      // did not. Reporting only the first would over-claim the new guarantee.
      attachment: boundaryAttachment,
      contracts: {
        modelled: CONTRACTS.filter((c) => c.modelled).map((c) => c.id),
        declaredGaps: CONTRACTS.filter((c) => !c.modelled).map((c) => c.id),
      },
      facts: lifted.facts,
    },
    semanticCoverage: {
      ledger: {
        ...semanticCoverage,
        // Internal origin metadata is used only to derive the declared skip
        // above.  The public ledger stays language-neutral and serializable.
        unmeasuredMeta: undefined,
      },
      unmeasured: semanticCoverage.unmeasured.length,
    },
    counts: countGraph(graph),
  };

  if (authorizationPolicy !== undefined) {
    report.authorizationPolicy = checkAuthorizationPolicy(
      canonicalizeGraph(graph),
      report,
      authorizationPolicy,
    );
  }
  if (sourceAuthorizationPolicy !== undefined)
    report.sourceAuthorization = checkSourceAuthorization(
      cwd,
      canonicalizeGraph(graph),
      extracted,
      sourceAuthorizationPolicy,
      compilationFiles,
      stack.pythonCmd,
    );
  const outPath = write ? writeGraph(graph, cwd, out) : null;
  return { graph, json: serializeGraph(graph), report, outPath };
}

function structuralCoverageFor(framework, extracted, graph) {
  const parsedFacts = [];
  const facts = new Map();
  const exactFactIds = [];
  const push = (origin, value, id, kind, source, extra = {}) => {
    const fact = {
      id,
      kind,
      language: framework,
      source,
    };
    parsedFacts.push(fact);
    facts.set(id, { origin, source, ...extra });
    return id;
  };

  for (const [index, route] of (extracted.routes ?? []).entries()) {
    const id = push(
      'route',
      route,
      `structural:${framework}:route:${route.sourceFile ?? '<unknown>'}:${route.sourceLine ?? 0}:${route.method}:${route.path}:${index}`,
      'route-registration',
      { file: route.sourceFile ?? '<unknown>', line: route.sourceLine ?? 0 },
      { method: route.method, path: route.path },
    );
    if (graph.nodes.has(`entrypoint:${route.method.toUpperCase()} ${route.path}`))
      exactFactIds.push(id);
  }
  for (const [index, handler] of (extracted.unknownHandlers ?? []).entries()) {
    push(
      'unknown-handler',
      handler,
      `structural:${framework}:unknown-handler:${handler.file ?? '<unknown>'}:${handler.line ?? 0}:${handler.target ?? '<unknown>'}:${index}`,
      'unresolved-registration',
      { file: handler.file ?? '<unknown>', line: handler.line ?? 0 },
    );
  }
  for (const [index, skipped] of (extracted.skipped ?? []).entries()) {
    push(
      'declared-skip',
      skipped,
      `structural:${framework}:skip:${skipped.file ?? '<unknown>'}:${skipped.line ?? 0}:${index}`,
      'declared-skip',
      { file: skipped.file ?? '<unknown>', line: skipped.line ?? 0 },
    );
  }

  const ledger = structuralCoverage({ parsedFacts, claimedFactIds: exactFactIds });
  return { ...ledger, unmeasuredMeta: facts };
}

function countGraph(graph) {
  const nodes = {};
  const edges = {};
  for (const n of graph.nodes.values()) nodes[n.kind] = (nodes[n.kind] ?? 0) + 1;
  for (const e of graph.edges) edges[e.kind] = (edges[e.kind] ?? 0) + 1;
  return { nodes, edges, totalNodes: graph.nodes.size, totalEdges: graph.edges.length };
}
