// detect-evidence.test.js — Fabric F4: a selected entry must carry the competing
// candidates and an unrecognised program must become an actionable blind spot, never 0 routes.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectEvidence, detectStack } from '../src/detect.js';
import { compileUBG } from '../src/ubg/compile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, 'fixtures', name);

describe('Fabric F4 — detected boundaries carry their evidence', () => {
  it('publishes evidence, the competing entry, and incomplete coverage with the selected stack', () => {
    const app = fixture('ubg-fabric-detect-ambiguous');
    const stack = detectStack(app);

    expect(stack.detection.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'package-manifest', file: 'package.json' }),
        expect.objectContaining({
          kind: 'ambiguous-entry-selection',
          file: stack.entryFile,
        }),
      ]),
    );
    expect(stack.detection.alternativeCandidates).toContain('src/bootstrap.ts');
    expect(stack.detection.coverage).toMatchObject({
      entry: 'ambiguous',
      complete: false,
    });
    expect(stack.detection.blindspots).toEqual([
      expect.objectContaining({
        kind: 'ambiguous-entry',
        risk: 'high',
        status: 'unmeasured',
      }),
    ]);

    const { report } = compileUBG(app, { write: false });
    expect(report.detection).toEqual(stack.detection);
    expect(
      report.skipped.some((skip) => skip.reason.includes('entry point GUESSED')),
    ).toBe(true);
  });

  it('returns UNKNOWN FRAMEWORK as a high-risk actionable blind spot rather than a clean empty surface', () => {
    const app = fixture('ubg-fabric-detect-unknown');
    const detected = detectEvidence(app);

    expect(detected).toMatchObject({
      status: 'UNKNOWN FRAMEWORK',
      framework: null,
      entry: null,
      coverage: { framework: 'unmeasured', entry: 'unmeasured', complete: false },
    });
    expect(detected.blindspots).toEqual([
      expect.objectContaining({
        kind: 'unknown-framework',
        risk: 'high',
        status: 'unmeasured',
      }),
    ]);
    expect(() => compileUBG(app, { write: false })).toThrow(
      'No supported framework found',
    );
  });
});
