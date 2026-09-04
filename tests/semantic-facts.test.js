import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_PHASE,
  SEMANTIC_STATE,
  fastSemanticCandidates,
  reconcileSemanticFacts,
  semanticStatus,
} from '../src/ubg/semantic-facts.js';

const nodeGoatSurface = [
  {
    id: 'js:server.js:3:setup-call',
    kind: 'setup-call',
    language: 'javascript',
    source: { file: 'server.js', line: 3 },
  },
  {
    id: 'js:routes/index.js:2:registration',
    kind: 'route-registration',
    language: 'javascript',
    source: { file: 'routes/index.js', line: 2 },
  },
];

describe('semantic fact protocol', () => {
  it('keeps the fast layer at candidate strength', () => {
    const candidates = fastSemanticCandidates([...nodeGoatSurface].reverse());

    expect(candidates.map(({ id, phase, state }) => [id, phase, state])).toEqual([
      [
        'js:routes/index.js:2:registration',
        SEMANTIC_PHASE.FAST,
        SEMANTIC_STATE.CANDIDATE,
      ],
      ['js:server.js:3:setup-call', SEMANTIC_PHASE.FAST, SEMANTIC_STATE.CANDIDATE],
    ]);
  });

  it('makes unlinked parsed surface explicit uncertainty', () => {
    const ledger = reconcileSemanticFacts({
      parsedFacts: nodeGoatSurface,
      exactFactIds: ['js:server.js:3:setup-call'],
    });

    expect(ledger.conservation).toMatchObject({
      parsed: 2,
      modelled: 1,
      unmeasured: 1,
    });
    expect(ledger.unmeasured[0].id).toBe('js:routes/index.js:2:registration');
    expect(semanticStatus(ledger)).toBe('unknown');
  });

  it('discharges the same cross-file facts deterministically', () => {
    const forward = reconcileSemanticFacts({
      parsedFacts: nodeGoatSurface,
      exactFactIds: nodeGoatSurface.map((fact) => fact.id),
    });
    const reverse = reconcileSemanticFacts({
      parsedFacts: [...nodeGoatSurface].reverse(),
      exactFactIds: [...nodeGoatSurface].reverse().map((fact) => fact.id),
    });

    expect(semanticStatus(forward)).toBe('proven');
    expect(forward.conservation.fingerprint).toBe(reverse.conservation.fingerprint);
  });

  it('prevents a language pack from inventing or hiding facts', () => {
    expect(() =>
      reconcileSemanticFacts({
        parsedFacts: nodeGoatSurface,
        exactFactIds: ['missing:fact'],
      }),
    ).toThrow(/has no parsed fact to conserve/);
    expect(() =>
      reconcileSemanticFacts({
        parsedFacts: nodeGoatSurface,
        justifiedIrrelevant: ['js:server.js:3:setup-call'],
      }),
    ).toThrow(/independently checkable/);
  });
});
