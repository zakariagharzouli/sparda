// A hard negative certifies ONE property. Counting a finding about another one
// as a precision error conflates "SPARDA is noisy" with "SPARDA answered a
// different question", and a number that conflates those is a number nobody can
// act on.
//
// This does NOT make SPARDA quieter: `anyHardFinding` keeps the pre-split figure
// so the change of DEFINITION can never be mistaken for a change in behaviour.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_PROPERTY, inDeclaredScope, summarize } from '../bench/soundness/run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, '..', 'bench', 'soundness', 'cases');

const negative = (id, safeFor, rules) => ({
  id,
  classification: 'safe',
  measurement: 'scored',
  route: 'POST /x',
  safeFor,
  hardFindings: rules.map((rule) => ({ rule, severity: 'high' })),
  routeVerdict: 'NOT_PROVEN',
  routeClaim: 'FINDING',
  linkage: {},
});

describe('a finding is judged against the property the human verified', () => {
  it('an authorization finding on an authorization-scoped label IS a false high', () => {
    expect(inDeclaredScope('UNGUARDED_MUTATION', ['authorization'])).toBe(true);
  });

  it('a compensation or atomicity finding on that label is OUT of scope', () => {
    expect(inDeclaredScope('IRREVERSIBLE_OBSERVABLE', ['authorization'])).toBe(false);
    expect(inDeclaredScope('NON_ATOMIC_AGGREGATE_WRITE', ['authorization'])).toBe(false);
  });

  it('an UNMAPPED rule is in scope by default — never invisible by omission', () => {
    // The failure this guards: a new rule silently stops counting anywhere
    // because nobody added it to the table.
    expect(inDeclaredScope('SOME_NEW_RULE', ['authorization'])).toBe(true);
    expect(RULE_PROPERTY.SOME_NEW_RULE).toBeUndefined();
  });

  it('reports BOTH numbers, so a definition change cannot pass as a behaviour change', () => {
    const summary = summarize([
      negative('in-scope', ['authorization'], ['UNGUARDED_MUTATION']),
      negative('out-of-scope', ['authorization'], ['IRREVERSIBLE_OBSERVABLE']),
      negative('clean', ['authorization'], []),
    ]);
    expect(summary.hardNegatives.cases).toBe(3);
    expect(summary.hardNegatives.falseHigh).toBe(1);
    expect(summary.hardNegatives.anyHardFinding).toBe(2);
    expect(summary.hardNegatives.outOfScopeFindings).toBe(1);
    expect(summary.hardNegatives.outOfScope[0].id).toBe('out-of-scope');
  });

  it('a route with an in-scope AND an out-of-scope finding counts as in-scope', () => {
    // Conservative: a real precision error is never excused by the presence of
    // an unrelated finding beside it.
    const summary = summarize([
      negative(
        'both',
        ['authorization'],
        ['UNGUARDED_MUTATION', 'IRREVERSIBLE_OBSERVABLE'],
      ),
    ]);
    expect(summary.hardNegatives.falseHigh).toBe(1);
    expect(summary.hardNegatives.outOfScopeFindings).toBe(0);
  });
});

describe('every hard negative in the corpus declares what it is safe FOR', () => {
  it('and the declaration is a non-empty list', () => {
    const negatives = fs
      .readdirSync(casesDir)
      .map((c) =>
        JSON.parse(fs.readFileSync(path.join(casesDir, c, 'truth.json'), 'utf8')),
      )
      .filter((c) => c.hardNegative === true);
    expect(negatives.length).toBeGreaterThan(0);
    for (const c of negatives) {
      expect(Array.isArray(c.safeFor)).toBe(true);
      expect(c.safeFor.length).toBeGreaterThan(0);
      // Every criterion in this corpus names an authorization property in so
      // many words; if that ever stops being true, the scope must be re-read
      // from the criterion rather than assumed.
      for (const property of c.safeFor)
        expect(Object.values(RULE_PROPERTY)).toContain(property);
    }
  });
});
