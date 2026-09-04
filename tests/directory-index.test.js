// `app.use('/api', require('./routes'))` — which shapes of a CommonJS directory
// require SPARDA may resolve, and which it must refuse.
//
// The capability itself was NOT added here: `firstModuleFile` has tried
// `<dir>/index.js` since long before this file existed, and a fixture reproducing
// the NodeGoat shape resolves today. What this file pins is the SOUNDNESS of that
// resolution, and it closed two real holes:
//
//   * a directory carrying its OWN `package.json` — Node consults `main`, so
//     guessing `index.js` analyses a DIFFERENT module than the one that runs.
//     Measured before the fix: the fixture served `/main-field-entry` and SPARDA
//     reported `/index-not-the-entry`.
//   * `require` shadowed by a local binding — the call loads whatever the caller
//     passes, so resolving it reports a route the server never serves.
//
// Both directions matter. Resolving a target SPARDA should not is not "extra
// coverage": it makes the reported route set differ from the served one, which
// is Direction 3's failure in both signs at once.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const compile = (name) => {
  const { graph, report } = compileUBG(path.join(here, 'fixtures', name), {
    write: false,
  });
  const g = canonicalizeGraph(graph);
  return {
    g,
    report,
    routes: g.nodes
      .filter((n) => n.kind === 'entrypoint')
      .map((n) => n.id)
      .sort(),
    skips: (report.skipped ?? []).map((s) => s.reason),
  };
};

const matrix = compile('directory-index');
const shadowed = compile('directory-index-shadowed');
const skipFor = (target) => matrix.skips.filter((r) => r.includes(target));

describe('what a directory require IS allowed to resolve', () => {
  it('1 — `require("./routes")` reaches routes/index.js, and its route is visible', () => {
    // the NodeGoat shape, reproduced without copying the external repository
    expect(matrix.routes).toContain('entrypoint:POST /api/widgets');
  });

  it('2 — a FILE always beats a directory index, exactly as Node orders them', () => {
    // `mixed.js` and `mixed/index.js` both exist. Node loads the file.
    expect(matrix.routes).toContain('entrypoint:GET /mixed/from-file');
    expect(matrix.routes).not.toContain('entrypoint:GET /mixed/from-directory-index');
  });
});

describe('what it must REFUSE — and declare', () => {
  const refuses = [
    ['3 — a dynamic specifier is not a static target', '/dynamic'],
    ['4 — a real directory with no index', './no-index'],
    ['5 — a directory that owns its resolution via package.json', './owned'],
    ['6 — a bare package is not a local directory', "require('express')"],
    ['7a — index.cjs is not index.js', './cjs-only'],
    ['7b — index.mjs is not index.js', './esm-only'],
  ];

  for (const [title, marker] of refuses)
    it(`${title} — refused, and DECLARED`, () => {
      // the refusal must leave a trace: a silent null is the loss shape hard
      // rule 9 forbids, and it reads downstream exactly like a mount that
      // carried nothing
      expect(skipFor(marker).length, marker).toBeGreaterThan(0);
    });

  it('5b — the manifest directory contributes NEITHER of its two candidate files', () => {
    // before the fix SPARDA reported `/index-not-the-entry`, which the server
    // never serves, and missed `/main-field-entry`, which it does
    expect(matrix.routes).not.toContain('entrypoint:GET /owned/index-not-the-entry');
    expect(matrix.routes).not.toContain('entrypoint:GET /owned/main-field-entry');
  });

  it('7c — no refused directory smuggles a route in by another door', () => {
    for (const ghost of [
      'entrypoint:GET /cjs/from-cjs',
      'entrypoint:GET /no-index',
      'entrypoint:GET /bare',
    ])
      expect(matrix.routes).not.toContain(ghost);
  });
});

describe('11 — a lexically shadowed `require` is not the host’s require', () => {
  it('the mount is refused, not resolved to the module it names', () => {
    expect(shadowed.routes).not.toContain('entrypoint:POST /api/real-module-route');
  });

  it('and the refusal is declared', () => {
    expect(shadowed.skips.some((r) => r.includes("require('./routes')"))).toBe(true);
  });

  it('the rest of the application survives — the refusal is local', () => {
    expect(shadowed.routes).toContain('entrypoint:POST /local');
  });
});

describe('13 — an unresolved mount cannot leave the route reading PROVEN', () => {
  it('every refusal becomes a blind spot', () => {
    const spots = surveyBlindspots(matrix.g, matrix.report).spots;
    expect(spots.filter((s) => s.kind === 'skipped-surface').length).toBe(
      matrix.skips.length,
    );
  });

  it('the application cannot read PROVEN while a mount is unresolved', () => {
    for (const app of [matrix, shadowed]) {
      const b = surveyBlindspots(app.g, app.report);
      const { findings } = checkGraph(app.g);
      const state = verdictState(
        verdictOf(findings, app.g, {
          coverage: b.coverage.ratio,
          blindHigh: b.byRisk.critical + b.byRisk.high,
        }),
      );
      expect(state).not.toBe('PROVEN');
    }
  });

  it('a refused mount never credits auth, ownership or validation', () => {
    // resolving a directory reveals BEHAVIOUR; it may never manufacture a guard.
    // No fixture route here is guarded, so no guard node may exist at all.
    expect(matrix.g.nodes.filter((n) => n.kind === 'guard')).toEqual([]);
    expect(shadowed.g.nodes.filter((n) => n.kind === 'guard')).toEqual([]);
  });
});

describe('the application is never emptied by a refusal', () => {
  it('a plain local route survives every refused mount', () => {
    expect(matrix.routes).toContain('entrypoint:POST /local');
  });
});
