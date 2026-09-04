// effect-location-follows-the-body.test.js — E-099.
//
// A blind spot is what SPARDA offers INSTEAD of a proof, so its location is the whole
// artifact: a ledger of 139 entries that point at the wrong lines is not a weaker proof,
// it is an unusable one. The bug was that an effect's two halves came from different
// files — `line` from the body the resolver actually scanned, `file` from the route that
// reached it — so every location was individually right and jointly meaningless.
//
// The fixture is a real DI ladder: controller → service (inherited constructor) →
// repository, where the ONLY effect lives two hops down. The assertion is not "the file
// changed": it is that the file and the line name the same statement.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, 'fixtures', name);

const effectsOf = (dir) =>
  canonicalizeGraph(compileUBG(dir, { write: false }).graph).nodes.filter(
    (n) => n.kind === 'effect',
  );

// the source line a location POINTS AT, read back off disk — the only way to assert
// that the two halves belong together instead of merely differing
const lineAt = (dir, loc) =>
  fs.readFileSync(path.join(dir, loc.file), 'utf8').split(/\r?\n/)[loc.line - 1] ?? '';

describe('E-099 — an effect is located where its body is, not where its route is', () => {
  it('a two-hop DI effect names the repository file AND the repository line', () => {
    const dir = fixture('ubg-nestjs-deep');
    const effects = effectsOf(dir);
    expect(effects.length).toBeGreaterThan(0);

    const insert = effects.find((n) => n.meta.table === 'things');
    expect(insert).toBeTruthy();
    // the declaring file — two DI hops below the controller that reaches it
    expect(insert.loc.file).toBe('src/repositories/thing.repository.ts');
    // …and the line it names is the statement that produces the effect. Before the fix
    // the file was the controller's and this same line number landed on a blank line.
    expect(lineAt(dir, insert.loc)).toContain("insertInto('things')");
  });

  it('every effect location points at code that could plausibly produce it', () => {
    // the general form of the invariant: a location must not resolve to an import, a
    // blank line, or past the end of its file. Run over the DI fixtures, where the
    // resolver merges bodies across files and the mismatch is possible at all.
    for (const name of ['ubg-nestjs-deep', 'ubg-nest-barrel-di', 'ubg-typeorm-nest']) {
      const dir = fixture(name);
      for (const n of effectsOf(dir)) {
        const text = lineAt(dir, n.loc).trim();
        expect(text, `${name} → ${n.loc.file}:${n.loc.line} (${n.label})`).not.toBe('');
        expect(text, `${name} → ${n.loc.file}:${n.loc.line} (${n.label})`).not.toMatch(
          /^import\b/,
        );
      }
    }
  });

  it('the blind-spot ledger points at the write, not at a blank line in the controller', () => {
    // The fixture is built so the two candidate locations SHARE a line number: line 10
    // is the `fs.writeFileSync` in the service and a blank line in the controller. A
    // test that only asserted "the file is the service" would still pass if the line
    // were taken from the wrong body; asserting the TEXT is what pins the pair.
    const dir = fixture('nest-di-blindspot-location');
    const g = canonicalizeGraph(compileUBG(dir, { write: false }).graph);
    const spots = surveyBlindspots(g).spots.filter((s) => s.kind === 'opaque-target');
    expect(spots).toHaveLength(1);
    expect(spots[0].location).toBe('src/services/export.service.ts:10');

    const [file, line] = splitLocation(spots[0].location);
    expect(fs.existsSync(path.join(dir, file))).toBe(true);
    expect(lineAt(dir, { file, line })).toContain('fs.writeFileSync');
    // and the location the bug used to produce is genuinely empty — the ledger was
    // not merely imprecise, it named nothing at all
    expect(
      lineAt(dir, { file: 'src/controllers/export.controller.ts', line }).trim(),
    ).toBe('');
  });
});

function splitLocation(location) {
  const at = location.lastIndexOf(':');
  return [location.slice(0, at), Number(location.slice(at + 1))];
}
