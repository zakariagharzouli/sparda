import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuralCoverage } from '../src/ubg/semantic-facts.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'ubg-fabric-coverage');

describe('Fabric F2 structural coverage', () => {
  it('computes parsed − claimed − justified-irrelevant as explicit unmeasured facts', () => {
    const ledger = structuralCoverage({
      parsedFacts: [
        { id: 'f:one', kind: 'registration', source: { file: 'app.js', line: 1 } },
        { id: 'f:two', kind: 'registration', source: { file: 'app.js', line: 2 } },
      ],
      claimedFactIds: ['f:one'],
    });

    expect(ledger.coverage).toEqual({
      parsed: 2,
      claimed: 1,
      justifiedIrrelevant: 0,
      unmeasured: 1,
      complete: false,
    });
    expect(ledger.unmeasured.map((fact) => fact.id)).toEqual(['f:two']);
    expect(ledger.justifiedIrrelevant).toEqual([]);
  });

  it('rejects even one justified-irrelevant fact until an independent checker exists', () => {
    expect(() =>
      structuralCoverage({
        parsedFacts: [{ id: 'f:one', kind: 'registration', source: { file: 'app.js' } }],
        claimedFactIds: [],
        justifiedIrrelevant: ['f:one'],
      }),
    ).toThrow(/independently checkable/);
  });

  it('wires every lowering through structural coverage and lets a lost route contaminate the verdict', () => {
    const { graph, report } = compileUBG(fixture, { write: false });
    const canonical = canonicalizeGraph(graph);
    const ghost = report.semanticCoverage.ledger.unmeasured.find(
      (fact) => fact.source.file === 'src/app.js' && fact.source.line === 16,
    );
    const blind = surveyBlindspots(canonical, report);
    const { findings } = checkGraph(canonical);
    const verdict = verdictOf(findings, canonical, {
      coverage: blind.coverage.ratio,
      blindHigh: blind.byRisk.critical + blind.byRisk.high,
      premiseBasis: 'declared',
    });

    expect(report.framework).toBe('express');
    expect(ghost?.state).toBe('unmeasured');
    expect(
      report.skipped.some((skip) => skip.reason.includes('unmeasured structural route')),
    ).toBe(true);
    expect(blind.byRisk.high).toBeGreaterThan(0);
    expect(verdictState(verdict)).not.toBe('PROVEN');
  });
});
