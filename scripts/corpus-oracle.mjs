// corpus-oracle.mjs — the regression net for real giants.
//
// SPARDA's in-repo fixtures pin the small, hand-made cases. The GIANTS (dub, novu,
// twenty, …) are where precision lives and dies — the tsconfig bug (E-039) silently took
// dub's guards from 514 to 1, and nothing sounded an alarm because no test watches a
// giant. This does. It compiles each pinned app, computes a handful of drift-sensitive
// metrics (verdict, findings by rule, db_writes/reads, guards verified, coverage), and
// diffs them against a COMMITTED snapshot (corpus.snapshot.json). Any drift — a verdict
// flip, a finding count jump, guards collapsing, writes re-inflating — exits non-zero.
//
// The giants themselves are NOT committed (huge, and this environment is ephemeral). The
// snapshot is. Point SPARDA_CORPUS at a directory holding the cloned giants; apps that are
// not present are SKIPPED (reported, never failed), so the oracle runs wherever the corpus
// happens to be cached and is a no-op where it isn't.
//
//   SPARDA_CORPUS=/path/to/corpus node scripts/corpus-oracle.mjs           # check
//   SPARDA_CORPUS=/path/to/corpus node scripts/corpus-oracle.mjs --update  # re-baseline
//
// Re-baseline ONLY when a metric change is intended, and say why in the commit — the
// snapshot is the record of "what SPARDA sees on real code," and it must move on purpose.
//
// THE PREMISE (ADR-083). This file grades a compiled graph and prints a verdict word, so
// it is bound by the same rule as every other consumer: the premise is checked BEFORE the
// proof is graded. It shipped without that check, which made the corpus — the only place
// SPARDA states a verdict over code it did not write — the one surface where a `PROVEN`
// could still stand over an app whose route table no oracle had ever seen. The metrics
// below therefore pin `premiseGaps` and `premiseOracle` alongside the verdict: an oracle
// that silently goes UNAVAILABLE is a regression in the honesty organ itself, and pinning
// only the gap count would read that failure as good news (0 gaps).
//
// PROVENANCE. The metrics are a function of two moving trees: SPARDA and the giant. The
// snapshot used to record only the first, so any drift was uninterpretable — "did we get
// better, or did dub land 14 routes?" Each entry now carries the corpus commit it was
// baselined on (`_pinned`), which is NOT diffed (the giants moving is not SPARDA drifting)
// but IS printed next to every delta, so the next reader can attribute the movement instead
// of guessing at it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph, cmp } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';
import { certifiableOrgan, withPremiseGaps, basisFrom } from '../src/ubg/premise.js';
import {
  dataFlowCoverageOf,
  originCoverageOf,
  providerLinkageOf,
  routeRiskOf,
  setDelta,
} from './route-risk.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(here, '..', 'corpus.snapshot.json');

// name → the app dir relative to SPARDA_CORPUS. Monorepos point at the analyzable package.
const APPS = [
  { name: 'dub', dir: 'dub/apps/web' },
  { name: 'novu', dir: 'novu' },
  { name: 'cal.com', dir: 'cal.com' },
  { name: 'twenty', dir: 'twenty/packages/twenty-server' },
  { name: 'immich', dir: 'immich/server' },
  // the analyzable package, not the monorepo root: the root stopped detecting upstream
  // (`suggestAppDirs` points here), and a corpus entry that cannot compile checks nothing
  { name: 'nocodb', dir: 'nocodb/packages/nocodb' },
  { name: 'ghostfolio', dir: 'ghostfolio' },
  // TAPP-2's subject, and the reason it is here rather than in a fixture only.
  // NodeGoat is the one pinned app whose entire request-to-effect path crosses a
  // call boundary — route → handler factory → captured DAO instance → positional
  // parameter → Mongo. Six giants produce ZERO resolved access paths, so without
  // this entry `npm run corpus` would print "0 drifted" the day the
  // interprocedural seam silently stopped resolving: the exact shape of the #47
  // failure, one capability later. It is small, so the cost is a second of
  // compile; it is the only place the gate can see this capability at all.
  { name: 'nodegoat', dir: 'nodegoat' },
];

// The metrics we pin. Chosen to be drift-SENSITIVE (they move when precision moves) and
// STABLE (integers + a rounded coverage, no float noise, no source-line churn).
async function metricsOf(appDir) {
  const { graph, report } = compileUBG(appDir, { write: false });
  const g = canonicalizeGraph(graph);
  const { findings } = checkGraph(g);
  // THE PREMISE, before the metrics. `probe` is deliberately absent: the runtime oracle
  // EXECUTES the target's code, and the corpus is seven third-party apps compiled in bulk
  // — the one place SPARDA must never boot what it measures. The boot-free convention
  // oracle costs a directory walk and runs on every lowering that has one.
  const premise = await certifiableOrgan('corpus-oracle').premise(g, report, {
    cwd: appDir,
  });
  // gaps enter the blind-spot ledger at critical risk, exactly as in every command: one
  // channel, so coverage here means the same thing it means on the badge
  const b = surveyBlindspots(g, withPremiseGaps(report, premise));
  // Share the CLI's verdict logic verbatim — same coverage AND blindHigh inputs, same
  // `verdictState` mapping — so the oracle can never disagree with `sparda apocalypse` on the
  // verdict word (the PARTIAL rung used to be missing here: cal.com read PROVEN at 23% coverage
  // while the CLI said PARTIAL).
  const v = verdictOf(findings, g, {
    coverage: b.coverage.ratio,
    blindHigh: b.byRisk.critical + b.byRisk.high,
    premiseGaps: premise.available ? premise.gaps.length : 0,
    premiseBasis: basisFrom(premise),
  });
  const verdict = verdictState(v);
  const kind = (k) =>
    g.nodes.filter((n) => n.kind === 'effect' && n.meta.effectType === k).length;
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  const guards = g.nodes.filter((n) => n.kind === 'guard');
  // hard findings gate the verdict; advisories (BOLA/IDOR) are a review list, tracked
  // separately so a precision change in one never masquerades as a change in the other.
  const hard = findings.filter((f) => !f.advisory);
  // The gap ROUTES travel beside the metrics, never inside them: which route the compiler
  // missed is what a reader must act on, but pinning the list would make the snapshot churn
  // on any upstream rename of a route SPARDA already fails to see.
  const gapRoutes = (premise.gaps ?? []).map((x) => `${x.method} ${x.path}`);
  const m = {
    verdict,
    routes: report.routes,
    // Which oracle ran, pinned as a metric of its own. `null` means no oracle looked at
    // this app's route table — the state the whole premise organ exists to make visible,
    // and the one an unpinned gap count would disguise as a clean bill of health.
    premiseOracle: premise.available ? premise.oracle : null,
    // How much surface the oracle actually enumerated. Pinned because "0 gaps" means two
    // very different things at 591 routes checked (a real second opinion on the whole app)
    // and at 1 (cal.com: an oracle that saw almost nothing and therefore contradicted
    // nothing). Soundness is unaffected either way — gaps only ever WITHHOLD a verdict —
    // but a reader deserves to know how strong the check behind a clean premise was.
    premiseProbed: premise.available ? premise.probed : 0,
    premiseGaps: premise.available ? premise.gaps.length : 0,
    premiseBasis: basisFrom(premise),
    findings: hard.length,
    advisories: findings.length - hard.length,
    findingsByRule: Object.fromEntries(Object.entries(byRule).sort()),
    dbWrites: kind('db_write'),
    dbReads: kind('db_read'),
    guards: guards.length,
    guardsVerified: guards.filter((n) => n.meta.verified).length,
    coverage: Math.round(b.coverage.ratio * 1000) / 10, // one decimal %
    // The route-scoped risk result PR #47 introduced. Pinned as a SET, not a
    // total: 73 blocked routes becoming 73 different blocked routes is a change
    // in the analysis that no count can see. `blocked: null` means the lowering
    // has no ledger and the question was never asked — never "nothing is blocked".
    routeRisk: routeRiskOf({
      framework: report.framework,
      byRisk: b.byRisk,
      spots: b.spots,
    }),
    // TAPP-0: how much request→effect origin linkage this app actually has, and
    // in which of the three states. Pinned as a SET for the same reason
    // `routeRisk.blocked` is: the same number of links over different
    // occurrences is a changed analysis that no count can see.
    originCoverage: originCoverageOf(
      (report.kernel?.facts ?? []).filter((f) => f.kind === 'DbEffectOccurrence'),
    ),
    // TAPP-1: through WHAT a request value reached a role, on which route. Pinned
    // as a SET alongside its counts, so a resolved path quietly becoming a declared
    // boundary — or the reverse — is drift the gate reports instead of averaging away.
    // ADR-102: how much route→provider→ORM linkage this app's SOURCE proves, and
    // how much it declines. Both halves are pinned: a zero that stops being a
    // zero, and a refusal set that stops being refused, are the two ways this
    // capability can go wrong.
    providerLinkage: providerLinkageOf({
      framework: report.framework,
      linkages: (report.kernel?.facts ?? []).filter((f) => f.kind === 'ProviderLinkage'),
      boundaries: (report.kernel?.facts ?? []).filter(
        (f) => f.kind === 'UnknownBoundary' && f.provenance?.contract === 'nest/provider',
      ),
    }),
    dataFlowPaths: dataFlowCoverageOf(
      (report.kernel?.facts ?? []).filter((f) => f.kind === 'DataFlowPath'),
      (report.kernel?.facts ?? []).filter((f) => f.kind === 'DbEffectOccurrence'),
    ),
  };
  return { m, gapRoutes };
}

// The commit the metrics were measured on. Not a metric (a giant landing a PR is not
// SPARDA drifting), so `_`-prefixed keys are skipped by `diff` — it exists so a drift can
// be ATTRIBUTED: same commit ⇒ SPARDA moved; different commit ⇒ decompose before believing
// anything. Absent for a non-git corpus; the oracle degrades to its old, blind behaviour.
function pinnedHead(appDir) {
  try {
    // %H, not %h: an ABBREVIATION is not a pin. `--update` rewrote every stored
    // full sha down to 7 characters on each run, so the provenance degraded a
    // little every time anyone re-baselined, and `git fetch <sha>` cannot resolve
    // an abbreviation (E-098).
    const out = execFileSync('git', ['-C', appDir, 'log', '-1', '--format=%H %cs'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const [commit, date] = out.split(' ');
    return commit ? { commit, date } : null;
  } catch {
    return null;
  }
}

// `<oracle> N/M` — M routes enumerated by the second opinion, N of them missing from the
// graph. `none/0` is not a pass: it means nothing checked this app's premise at all.
const premiseNote = (m) =>
  `${m.premiseOracle ?? 'none'} ${m.premiseGaps}/${m.premiseProbed}`;

// A gap count is a number; a gap is a ROUTE somebody has to go look at. Named, always.
function reportGaps(routes) {
  for (const r of (routes ?? []).slice(0, 5))
    console.log(`        premise gap: ${r} — served, never compiled`);
  if ((routes ?? []).length > 5) console.log(`        … and ${routes.length - 5} more`);
}

// Two spellings of one commit: a full sha and any abbreviation of it.
const sameCommit = (a, b) =>
  Boolean(a) && Boolean(b) && (a.startsWith(b) || b.startsWith(a));

function diff(exp, got) {
  const deltas = [];
  // The UNION of both key sets, not just the snapshot's. Iterating only `exp`
  // makes a NEWLY PRODUCED metric invisible until someone baselines it — which is
  // exactly how the route-risk dimension could be added, produce a real result,
  // and still report "0 drifted". A gate that cannot see a new measurement cannot
  // see a deleted one either.
  for (const k of [...new Set([...Object.keys(exp), ...Object.keys(got)])].sort(cmp)) {
    if (k.startsWith('_')) continue; // provenance, not a metric
    const a = JSON.stringify(exp[k]);
    const bb = JSON.stringify(got[k]);
    if (a === bb) continue;
    // A 73-element array printed as `a → b` is a diff nobody reads, and a diff
    // nobody reads is a gate nobody can act on. Set-valued metrics report which
    // members moved.
    const setKey =
      k === 'routeRisk'
        ? 'blocked'
        : k === 'originCoverage'
          ? 'linked'
          : k === 'dataFlowPaths'
            ? 'paths'
            : k === 'providerLinkage'
              ? 'linked'
              : null;
    const moved = setKey ? setDelta(exp[k]?.[setKey], got[k]?.[setKey]) : null;
    if (moved && (moved.removed.length || moved.added.length)) {
      deltas.push(
        `    ${k}.${setKey}: ${exp[k][setKey].length} → ${got[k][setKey].length}`,
      );
      for (const r of moved.removed.slice(0, 8)) deltas.push(`      - ${r}`);
      if (moved.removed.length > 8)
        deltas.push(`      - …${moved.removed.length - 8} more removed`);
      for (const r of moved.added.slice(0, 8)) deltas.push(`      + ${r}`);
      if (moved.added.length > 8)
        deltas.push(`      + …${moved.added.length - 8} more added`);
      const restExp = { ...exp[k], [setKey]: null };
      const restGot = { ...got[k], [setKey]: null };
      if (JSON.stringify(restExp) !== JSON.stringify(restGot))
        deltas.push(
          `    ${k} (rest): ${JSON.stringify(restExp)} → ${JSON.stringify(restGot)}`,
        );
      continue;
    }
    deltas.push(`    ${k}: ${a} → ${bb}`);
  }
  return deltas;
}

const update = process.argv.includes('--update');
const base = process.env.SPARDA_CORPUS;
if (!base) {
  console.error(
    'SPARDA_CORPUS is not set — point it at a directory holding the cloned giants.',
  );
  console.error(
    '(The snapshot is committed; the giants are not. Nothing to check without them.)',
  );
  process.exit(update ? 1 : 0); // a plain check with no corpus is a graceful no-op
}

const snapshot = fs.existsSync(SNAPSHOT)
  ? JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  : {};
let drifted = 0;
let checked = 0;
let skipped = 0;
const next = { ...snapshot };

for (const app of APPS) {
  const dir = path.resolve(base, app.dir);
  if (!fs.existsSync(dir)) {
    console.log(`  SKIP  ${app.name.padEnd(12)} (not present under SPARDA_CORPUS)`);
    skipped++;
    continue;
  }
  const head = pinnedHead(dir);
  let got, gapRoutes;
  try {
    ({ m: got, gapRoutes } = await metricsOf(dir));
  } catch (e) {
    console.log(`  ERROR ${app.name.padEnd(12)} ${String(e.message).slice(0, 60)}`);
    drifted++;
    continue;
  }
  checked++;
  if (update) {
    next[app.name] = head ? { ...got, _pinned: head } : got;
    console.log(
      `  BASE  ${app.name.padEnd(12)} ${got.verdict} findings=${got.findings} writes=${got.dbWrites} guards=${got.guards}/${got.guardsVerified} premise=${premiseNote(got)}`,
    );
    reportGaps(gapRoutes);
    continue;
  }
  const exp = snapshot[app.name];
  if (!exp) {
    console.log(
      `  NEW   ${app.name.padEnd(12)} not in snapshot — run --update to baseline it`,
    );
    drifted++;
    continue;
  }
  const deltas = diff(exp, got);
  if (deltas.length) {
    console.log(`  DRIFT ${app.name.padEnd(12)}`);
    for (const d of deltas) console.log(d);
    // Attribution, not a verdict: the reader must know whether the tree under measurement
    // is the one the numbers were taken on before deciding this drift means anything.
    // Compared by PREFIX: the snapshot stores the full 40-char sha, `git log -1
    // --format=%h` yields an abbreviation, and comparing them as strings made this
    // line fire on every drift — an attribution signal that is always on tells the
    // reader nothing, and during a real investigation it actively misleads.
    if (head && exp._pinned && !sameCommit(head.commit, exp._pinned.commit))
      console.log(
        `    (corpus moved: baselined on ${exp._pinned.commit} ${exp._pinned.date}, measured on ${head.commit} ${head.date} — attribute before re-baselining)`,
      );
    reportGaps(gapRoutes);
    drifted++;
  } else {
    console.log(
      `  OK    ${app.name.padEnd(12)} ${got.verdict} findings=${got.findings} writes=${got.dbWrites} guards=${got.guards}/${got.guardsVerified} premise=${premiseNote(got)}`,
    );
    reportGaps(gapRoutes);
  }
}

if (update) {
  fs.writeFileSync(SNAPSHOT, JSON.stringify(next, null, 2) + '\n');
  console.log(`\nSnapshot written: ${checked} app(s) baselined, ${skipped} skipped.`);
  process.exit(0);
}

console.log(`\n${checked} checked, ${skipped} skipped, ${drifted} drifted.`);
process.exit(drifted ? 1 : 0);
