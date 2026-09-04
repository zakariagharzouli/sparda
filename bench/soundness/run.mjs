// Private soundness benchmark: external, pinned source only.
//
// This is deliberately not an accuracy vanity metric.  Its hard gate is the
// number of vulnerable routes that SPARDA would call PROVEN.  A missing route,
// a partial proof, or a noisy alert is reported as such; none may become a
// clean result by omission.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../../src/ubg/compile.js';
import { checkGraph, verdictOf, verdictState } from '../../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../../src/ubg/blindspots.js';
import { basisFrom, certifiableOrgan, withPremiseGaps } from '../../src/ubg/premise.js';
import { bodyKeyOfNodeId } from '../../src/ubg/schema.js';
import { canonicalizeGraph } from '../../src/ubg/schema.js';
import { verifySource } from './fingerprint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, 'cases');

const required = (value, message) => {
  if (!value) throw new Error(`soundness bench: ${message}`);
  return value;
};

function gitHead(dir) {
  // The desktop sandbox and the owner can have distinct Windows identities.
  // Declaring only this exact corpus directory safe changes no user-wide git
  // configuration and lets the pin check remain a real check in both contexts.
  return execFileSync(
    'git',
    ['-c', `safe.directory=${dir.replaceAll('\\', '/')}`, '-C', dir, 'rev-parse', 'HEAD'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
}

export function loadCases() {
  return fs
    .readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const truthPath = path.join(casesDir, entry.name, 'truth.json');
      required(fs.existsSync(truthPath), `${entry.name} has no truth.json`);
      return { ...JSON.parse(fs.readFileSync(truthPath, 'utf8')), truthPath };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function validateCases(cases) {
  const ids = new Set();
  for (const c of cases) {
    required(
      c.schema === 'sparda-soundness-case/v1',
      `${c.id ?? '<unknown>'} has an unknown schema`,
    );
    required(
      typeof c.id === 'string' && !ids.has(c.id),
      `duplicate or missing id ${c.id ?? '<unknown>'}`,
    );
    ids.add(c.id);
    required(
      ['vulnerable', 'safe'].includes(c.classification),
      `${c.id} has no vulnerable|safe truth`,
    );
    required(typeof c.type === 'string', `${c.id} has no type`);
    required(c.route?.method && c.route?.path, `${c.id} has no route`);
    required(
      c.label?.labelledBy && c.label?.criterion && c.label?.why,
      `${c.id} lacks review provenance`,
    );
    required(
      c.origin?.repository && c.origin?.url && c.origin?.corpus && c.origin?.commit,
      `${c.id} lacks pinned origin`,
    );
    required(
      ['scored', 'listed'].includes(c.measurement),
      `${c.id} must be scored or listed`,
    );
    required(
      Array.isArray(c.origin.source) && c.origin.source.length > 0,
      `${c.id} has no source byte pin`,
    );
    for (const source of c.origin.source) {
      required(
        source.path && /^[a-f0-9]{64}$/.test(source.sha256 ?? ''),
        `${c.id} has an invalid source pin`,
      );
      // A portable fingerprint is optional in the SCHEMA (an unmigrated case is
      // still a valid case) but must be well-formed when present.
      required(
        source.fingerprint == null || /^[a-f0-9]{64}$/.test(source.fingerprint),
        `${c.id} has an invalid portable fingerprint`,
      );
    }
    if (c.classification === 'vulnerable')
      required(c.missCause, `${c.id} must declare the cause used if it is missed`);
    if (c.classification === 'safe') {
      required(c.hardNegative === true, `${c.id} is safe but not a hard negative`);
      // A hard negative must say WHICH property its human verified. Without it,
      // a finding about another property silently counts as a precision error.
      required(
        Array.isArray(c.safeFor) && c.safeFor.length > 0,
        `${c.id} must declare the property it is safe FOR`,
      );
    }
  }
  required(cases.length >= 12, `needs at least 12 external cases, has ${cases.length}`);
  required(
    cases.filter((c) => c.classification === 'vulnerable').length > 0,
    'needs vulnerable cases',
  );
  required(
    cases.some((c) => c.classification === 'vulnerable' && c.measurement === 'scored'),
    'needs a scored vulnerable case',
  );
  required(cases.filter((c) => c.hardNegative).length > 0, 'needs hard negatives');
}

// Cases still relying on the platform-dependent raw byte pin. Reported, never
// silently accepted: a pin that only verifies on one machine is a debt.
const legacyPins = [];

function verifyCaseBytes(c, corpus) {
  const repo = path.resolve(corpus, c.origin.corpus);
  required(fs.existsSync(repo), `${c.id}: missing corpus repository ${repo}`);
  const actualHead = gitHead(repo);
  required(
    actualHead === c.origin.commit,
    `${c.id}: expected ${c.origin.commit}, got ${actualHead}`,
  );
  for (const source of c.origin.source) {
    const file = path.resolve(repo, source.path);
    required(file.startsWith(repo + path.sep), `${c.id}: source escapes repository`);
    // The portable fingerprint is checked when present; the raw byte pin is the
    // fallback so an unmigrated case is still verified rather than skipped. A
    // legacy pass is TRUE ON THIS PLATFORM and unproven anywhere else — it is
    // reported as `legacy`, never as `portable`.
    const result = verifySource(file, source);
    required(
      result.status !== 'mismatch',
      `${c.id}: ${result.reason} for ${source.path}`,
    );
    if (result.status === 'legacy') legacyPins.push(`${c.id}:${source.path}`);
  }
}

async function rawVerdictFor(appDir) {
  const { graph, report } = compileUBG(appDir, { write: false });
  const canonical = canonicalizeGraph(graph);
  const { findings } = checkGraph(canonical);
  // This is the existing boot-free static premise oracle. The benchmark never
  // boots third-party source, but it also never grades a graph without naming
  // what independently checked the compiled route set.
  const premise = await certifiableOrgan('soundness-bench').premise(canonical, report, {
    cwd: appDir,
  });
  const blindspots = surveyBlindspots(canonical, withPremiseGaps(report, premise));
  const verdict = verdictOf(findings, canonical, {
    coverage: blindspots.coverage.ratio,
    blindHigh: blindspots.byRisk.critical + blindspots.byRisk.high,
    premiseGaps: premise.available ? premise.gaps.length : 0,
    premiseBasis: basisFrom(premise),
  });
  return {
    graph: canonical,
    report,
    findings,
    blindspots,
    rawVerdict: verdictState(verdict),
  };
}

export function normalizeVerdict(rawVerdict) {
  if (rawVerdict === 'PROVEN') return 'PROVEN';
  if (rawVerdict === 'PARTIAL') return 'PARTIAL';
  if (rawVerdict === 'NOT_PROVEN' || rawVerdict === 'RISKY') return 'NOT_PROVEN';
  // NO_PROOF, SURFACE and PREMISE_GAP are all explicit non-claims.  The bench
  // presents them as UNKNOWN while retaining the original word in the report.
  return 'UNKNOWN';
}

function routeId(c) {
  return `entrypoint:${c.route.method.toUpperCase()} ${c.route.path}`;
}

// Semantic linkage — measured per case, and deliberately NOT a score.
//
// The vulnerability recall below answers "did SPARDA find the bug?". This
// answers a different and prior question: "how far along the chain did SPARDA
// actually get?". A run that reaches zero DB effects and a run that reaches them
// all score identically on recall, which is exactly how a compiler that saw
// nothing can look the same as one that saw everything.
//
// Every cell is `true`, `false` or `null`. `null` means UNMEASURED — the case
// declares nothing to check on that axis — and it never reads as a pass.
function linkageFor(c, result, entrypoint) {
  const nodes = new Map(result.graph.nodes.map((n) => [n.id, n]));
  const chain = result.graph.edges.filter(
    (e) => e.kind === 'control_flow' && e.meta?.route === entrypoint,
  );
  if (!nodes.has(entrypoint))
    return {
      routeRecognised: false,
      handlerLinked: false,
      asyncLinked: null,
      dbEffectReached: null,
      effectOccurrenceLinked: null,
      dataSourceLinked: null,
      guardProven: null,
      unknownBoundaries: null,
      unknownReasons: [],
    };

  // Route-scoped reachability: chain steps, then everything their bodies reach.
  const bodyEdges = new Map();
  for (const e of result.graph.edges)
    if (e.kind === 'control_flow' && !e.meta?.route) {
      if (!bodyEdges.has(e.from)) bodyEdges.set(e.from, []);
      bodyEdges.get(e.from).push(e.to);
    }
  const reached = new Set(chain.map((e) => e.to));
  const queue = [...reached];
  while (queue.length) {
    for (const next of bodyEdges.get(queue.shift()) ?? [])
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
  }
  const reachedNodes = [...reached].map((id) => nodes.get(id)).filter(Boolean);
  const dbEffects = reachedNodes.filter(
    (n) => n.kind === 'effect' && ['db_read', 'db_write'].includes(n.meta?.effectType),
  );

  const kernel = result.report.kernel;
  // Occurrences are already route-keyed, so this is an exact membership test
  // rather than a reachability guess: did THIS route's path produce a proof
  // about a DB operation, as opposed to merely reaching one another route
  // established something about.
  const occurrences = (kernel?.facts ?? []).filter(
    (f) => f.kind === 'DbEffectOccurrence' && f.entrypoint === entrypoint,
  );
  const guards = (kernel?.facts ?? []).filter(
    (f) => f.kind === 'GuardBoundary' && f.entrypoint === entrypoint,
  );
  // Route-scoped boundaries: a stop matters to THIS case when it happened while
  // resolving a body this route reaches. The join goes through `bodyKeyOfNodeId`,
  // the SAME canonical identity the resolver stamps on a boundary — this used to
  // rebuild `<file>#<line>` by hand, which is the duplicate-format bug one layer
  // out: the moment the canonical key gained its symbol, this silently matched
  // nothing and reported 0 route-scoped boundaries as if there were none. App-wide
  // counts are kept beside it because a boundary the join misses must still be
  // visible somewhere.
  const ownerKeys = new Set(
    reachedNodes.map((n) => bodyKeyOfNodeId(n.id)).filter(Boolean),
  );
  const allUnknown = (kernel?.facts ?? []).filter((f) => f.kind === 'UnknownBoundary');
  const unknown = allUnknown.filter((f) => f.owner && ownerKeys.has(f.owner));

  return {
    routeRecognised: true,
    handlerLinked:
      chain.length > 0 && chain.every((e) => nodes.get(e.to)?.meta?.opaque !== true),
    // A body that runs later, anywhere on the resolved path.
    asyncLinked: reachedNodes.some((n) => (n.meta?.continuations ?? []).length > 0),
    dbEffectReached: dbEffects.length > 0,
    // The distinction Priority 1 exists for: reaching a shared operation is not
    // the same as having a proof of your own about it.
    effectOccurrenceLinked: dbEffects.length === 0 ? null : occurrences.length > 0,
    // The half that makes the previous line mean something: not just that a DB
    // effect was reached, but that a request surface provably drives it.
    // Read off THIS route's occurrences, not off the shared node: the node
    // carries the union of every route's origins, which is right for a
    // conservative advisory and wrong as a statement about one route.
    dataSourceLinked:
      dbEffects.length === 0
        ? null
        : // TAPP-0 made these THREE-STATE: an array of origins, `[]` (inspected,
          // none) or `null` (not measurable — the role is absent, or the argument
          // is opaque). `null.length` used to be unreachable; reading it as 0
          // would now report "no request data drives this effect" about an
          // expression nobody could open, which is the false-clean direction.
          occurrences.every((o) => o.filterOrigins === null && o.dataOrigins === null)
          ? null
          : occurrences.some(
              (o) =>
                (o.filterOrigins ?? []).length > 0 || (o.dataOrigins ?? []).length > 0,
            ),
    // true = at least one guard met all four obligations; false = a guard is on
    // the chain and none did; null = no guard at all, which is not a failure to
    // measure a guard, it is the absence of one.
    guardProven: guards.length === 0 ? null : guards.some((g) => g.credited),
    unknownBoundaries: unknown.length,
    unknownReasons: [
      ...new Set(unknown.map((f) => f.provenance.uncertainty).filter(Boolean)),
    ].sort(),
    // The app-wide figure, kept so a route-scoped zero is never mistaken for an
    // application with nothing unresolved.
    appUnknownBoundaries: allUnknown.length,
  };
}

export function observeCase(c, result) {
  const entrypoint = routeId(c);
  const entrypointNode = result.graph.nodes.find((node) => node.id === entrypoint);
  const hasEntrypoint = Boolean(entrypointNode);
  const routeChain = result.graph.edges.filter(
    (edge) => edge.kind === 'control_flow' && edge.meta?.route === entrypoint,
  );
  const linkedRoute =
    hasEntrypoint &&
    routeChain.length > 0 &&
    routeChain.every((edge) => {
      const node = result.graph.nodes.find((candidate) => candidate.id === edge.to);
      return node?.meta?.opaque !== true;
    });
  const hardFindings = result.findings.filter(
    (finding) => finding.entrypoint === entrypoint && !finding.advisory,
  );
  const routeBlindspot = result.blindspots.spots.some(
    (spot) => spot.entrypoint === entrypoint,
  );
  // The generic blindspot survey is graph-oriented. A high-risk registration
  // declaration can be attached to the source line of an entrypoint before it
  // has a graph edge of its own (for example a route table installed from an
  // asynchronous setup callback). Preserve that uncertainty at the route level:
  // the route exists, but it cannot be a clean local claim until its setup is
  // structurally unconditional.
  const routeDeclaredUncertainty = result.report.skipped.some(
    (skip) =>
      ['critical', 'high'].includes(skip.risk) &&
      skip.file === entrypointNode?.loc?.file &&
      skip.line === entrypointNode?.loc?.line,
  );
  // `verdictState` is application-wide. A high on an unrelated route must
  // never disguise a vulnerable route which itself has no hard signal. Until
  // the public surface owns per-route verdicts, this is the conservative
  // route-level proxy: CLEAN is forbidden for a labelled vulnerable route.
  const routeClaim = !hasEntrypoint
    ? 'UNKNOWN'
    : hardFindings.length > 0
      ? 'FINDING'
      : routeBlindspot || routeDeclaredUncertainty
        ? 'UNKNOWN'
        : 'CLEAN';
  const routeVerdict = !hasEntrypoint
    ? 'UNKNOWN'
    : hardFindings.length > 0
      ? 'NOT_PROVEN'
      : routeBlindspot || routeDeclaredUncertainty
        ? 'UNKNOWN'
        : normalizeVerdict(result.rawVerdict);
  return {
    id: c.id,
    classification: c.classification,
    measurement: c.measurement,
    route: `${c.route.method.toUpperCase()} ${c.route.path}`,
    safeFor: c.safeFor ?? null,
    linkage: linkageFor(c, result, entrypoint),
    routeClaim,
    routeVerdict,
    rawApplicationVerdict: result.rawVerdict,
    observedEntrypoint: hasEntrypoint,
    linkedRoute,
    hardFindings: hardFindings.map((finding) => ({
      rule: finding.rule,
      severity: finding.severity,
    })),
    ...(c.classification === 'vulnerable' && routeVerdict !== 'NOT_PROVEN'
      ? { missCause: c.missCause }
      : {}),
  };
}

// Which PROPERTY each rule answers. Hand-written, and it is the whole point:
// a hard negative's label certifies ONE property — every criterion in this corpus
// names an authorization property in so many words ("authenticated",
// "unauthorized-mutation", "unauthenticated-mutation", "does not grant
// authenticated access"). A finding about compensation or atomicity is not a
// wrong answer to that question, it is an answer to a different one.
//
// This does NOT make SPARDA quieter. It splits one number that conflated two
// things into two numbers that each mean something, and BOTH are reported.
export const RULE_PROPERTY = Object.freeze({
  UNGUARDED_MUTATION: 'authorization',
  OBJECT_SCOPE_UNPROVEN: 'authorization',
  AGGREGATE_MEMBER_BYPASS: 'authorization',
  GUARD_REMOVED: 'authorization',
  ENTRYPOINT_REMOVED: 'authorization',
  NON_ATOMIC_AGGREGATE_WRITE: 'atomicity',
  IRREVERSIBLE_OBSERVABLE: 'compensation',
  UNVALIDATED_CONSTRAINED_WRITE: 'validation',
  UNBOUNDED_WRITE_TARGET: 'validation',
  INVARIANT_REMOVED: 'validation',
  BLAST_RADIUS_GREW: 'validation',
});

// A finding is IN SCOPE for a case when its rule answers a property the human
// actually verified. An unmapped rule is in scope by default: an unknown rule
// must never become invisible by omission.
export function inDeclaredScope(rule, safeFor) {
  const property = RULE_PROPERTY[rule];
  if (!property) return true;
  return (safeFor ?? []).includes(property);
}

const ratio = (numerator, denominator) =>
  denominator === 0 ? null : numerator / denominator;

export function summarize(observations) {
  // A listed case is a real external weakness, but outside today's declared
  // obligation scope. It remains visible but never silently turns into a
  // false-negative penalty for an analyser that made no such claim.
  const scored = observations.filter((o) => o.measurement === 'scored');
  const listed = observations.filter((o) => o.measurement === 'listed');
  const vulnerable = scored.filter((o) => o.classification === 'vulnerable');
  const negatives = scored.filter((o) => o.classification === 'safe');
  const falseProven = vulnerable.filter(
    (o) => o.routeVerdict === 'PROVEN' || o.routeClaim === 'CLEAN',
  );
  const caught = vulnerable.filter((o) => o.hardFindings.length > 0);
  const observedRoutes = vulnerable.filter((o) => o.observedEntrypoint);
  const linkedRoutes = vulnerable.filter((o) => o.linkedRoute);
  // In-scope: a hard finding answering a property this label certifies. That is
  // a precision error. Out-of-scope: a hard finding about a property the human
  // never verified — visible, counted, and never scored as either a failure or
  // a pass.
  const falseHigh = negatives.filter((o) =>
    o.hardFindings.some((f) => inDeclaredScope(f.rule, o.safeFor)),
  );
  const outOfScope = negatives.filter(
    (o) =>
      o.hardFindings.length > 0 &&
      !o.hardFindings.some((f) => inDeclaredScope(f.rule, o.safeFor)),
  );
  const anyHardFinding = negatives.filter((o) => o.hardFindings.length > 0);
  const unknown = scored.filter((o) => o.routeVerdict === 'UNKNOWN');
  const matchedHigh = scored.filter((o) => o.hardFindings.length > 0);

  // Counts, never a rate: "6 of 12 cases reach a DB effect" is actionable;
  // "50% semantic linkage" is a number someone would put on a slide.
  const AXES = [
    'routeRecognised',
    'handlerLinked',
    'asyncLinked',
    'dbEffectReached',
    'effectOccurrenceLinked',
    'dataSourceLinked',
    'guardProven',
  ];
  const tally = Object.fromEntries(
    AXES.map((axis) => [
      axis,
      {
        true: observations.filter((o) => o.linkage?.[axis] === true).length,
        false: observations.filter((o) => o.linkage?.[axis] === false).length,
        unmeasured: observations.filter((o) => o.linkage?.[axis] == null).length,
      },
    ]),
  );

  return {
    semanticLinkage: {
      // This section exists because vulnerability recall cannot see it: a
      // compiler that reaches no DB effect at all scores exactly like one that
      // reaches every effect and simply finds nothing wrong.
      cases: observations.length,
      axes: tally,
      routesWithBoundaries: observations.filter((o) => o.linkage?.unknownBoundaries > 0)
        .length,
      unknownReasons: [
        ...new Set(observations.flatMap((o) => o.linkage?.unknownReasons ?? [])),
      ].sort(),
      matrix: observations.map((o) => ({ id: o.id, route: o.route, ...o.linkage })),
    },
    headline: {
      falseProven: falseProven.length,
      vulnerableCases: vulnerable.length,
      externalCases: observations.length,
      scoredCases: scored.length,
      listedOutOfScope: listed.length,
      wording: `${falseProven.length} vulnerable route(s) blanched over ${vulnerable.length} scored vulnerable cases; ${observations.length}/${observations.length} are external and pinned (${listed.length} listed outside current obligation scope)`,
    },
    hardNegatives: {
      cases: negatives.length,
      falseHigh: falseHigh.length,
      // The pre-split number, kept so the change of definition can never be
      // mistaken for a change in SPARDA's behaviour.
      anyHardFinding: anyHardFinding.length,
      outOfScopeFindings: outOfScope.length,
      outOfScope: outOfScope.map((o) => ({
        id: o.id,
        safeFor: o.safeFor ?? [],
        rules: o.hardFindings.map((f) => f.rule),
      })),
      noHighRate: ratio(negatives.length - falseHigh.length, negatives.length),
      // Candidate-level precision is intentionally narrow: a hard finding on
      // an externally labelled safe route is a false high, nothing more.
      precision: ratio(caught.length, matchedHigh.length),
    },
    coverage: {
      // This is route/behavior recognition, not vulnerability detection. Keeping the
      // two numbers separate prevents a newly visible but still UNKNOWN endpoint from
      // being sold as a caught security defect.
      routeRecall: ratio(observedRoutes.length, vulnerable.length),
      observedRoutes: observedRoutes.length,
      linkedRouteRecall: ratio(linkedRoutes.length, vulnerable.length),
      linkedRoutes: linkedRoutes.length,
      recall: ratio(caught.length, vulnerable.length),
      caught: caught.length,
      missed: vulnerable.length - caught.length,
      falseNegatives: vulnerable
        .filter((o) => o.hardFindings.length === 0)
        .map((o) => ({ id: o.id, cause: o.missCause })),
    },
    blindspots: {
      unknownCases: unknown.length,
      unknownRate: ratio(unknown.length, scored.length),
    },
    observations,
  };
}

export async function runBenchmark({ corpus = process.env.SPARDA_CORPUS } = {}) {
  required(corpus, 'SPARDA_CORPUS must point at the pinned external corpus');
  const cases = loadCases();
  validateCases(cases);
  const apps = new Map();
  for (const c of cases) {
    verifyCaseBytes(c, corpus);
    const appDir = path.resolve(corpus, c.origin.corpus, c.origin.appDir ?? '.');
    if (!apps.has(appDir)) apps.set(appDir, await rawVerdictFor(appDir));
  }
  if (legacyPins.length)
    console.error(
      `corpus: ${legacyPins.length} source pin(s) verified only by raw bytes — platform-dependent, migrate to a portable fingerprint: ${legacyPins.join(', ')}`,
    );
  const observations = cases.map((c) =>
    observeCase(
      c,
      apps.get(path.resolve(corpus, c.origin.corpus, c.origin.appDir ?? '.')),
    ),
  );
  return summarize(observations);
}

export function enforceSoundness(summary) {
  if (summary.headline.falseProven !== 0)
    throw new Error(
      `SOUNDNESS FAILURE: ${summary.headline.falseProven} vulnerable route(s) were blanched`,
    );
}

function print(summary) {
  console.log('SPARDA private soundness benchmark');
  console.log(summary.headline.wording);
  console.log(
    `hard negatives: ${summary.hardNegatives.falseHigh}/${summary.hardNegatives.cases} in-scope false high; ${summary.hardNegatives.anyHardFinding}/${summary.hardNegatives.cases} carry ANY hard finding; no-high rate=${summary.hardNegatives.noHighRate ?? 'unmeasured'}`,
  );
  for (const o of summary.hardNegatives.outOfScope)
    console.log(
      `  out of scope: ${o.id} is labelled safe for [${o.safeFor.join(', ')}]; finding(s) ${o.rules.join(', ')} answer another property`,
    );
  console.log(
    `candidate finding precision=${summary.hardNegatives.precision ?? 'unmeasured'}; route recall=${summary.coverage.routeRecall ?? 'unmeasured'}; linked-route recall=${summary.coverage.linkedRouteRecall ?? 'unmeasured'}; hard-finding recall=${summary.coverage.recall ?? 'unmeasured'}; UNKNOWN=${summary.blindspots.unknownRate ?? 'unmeasured'}`,
  );
  console.log('');
  console.log('semantic linkage (counts, not a rate — true/false/unmeasured):');
  for (const [axis, cells] of Object.entries(summary.semanticLinkage.axes))
    console.log(
      `  ${axis.padEnd(18)} true=${cells.true} false=${cells.false} unmeasured=${cells.unmeasured}`,
    );
  console.log(
    `  ${'routesWithBoundaries'.padEnd(18)} ${summary.semanticLinkage.routesWithBoundaries}/${summary.semanticLinkage.cases}`,
  );
  if (summary.semanticLinkage.unknownReasons.length)
    console.log(
      `  route-scoped boundary causes: ${summary.semanticLinkage.unknownReasons.join(', ')}`,
    );
  console.log('');
  for (const miss of summary.coverage.falseNegatives)
    console.log(`missed ${miss.id}: ${miss.cause}`);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const summary = await runBenchmark();
    print(summary);
    enforceSoundness(summary);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
