// `knex('users').update(...)` and `createHash('md5').update(...)` are the same
// SHAPE — an identifier called with a string literal, then a method out of the
// builder vocabulary. The analyser used to read both as a table, so every
// `createHash('sha256')` in a controller became a write to a table called
// "sha256": 172 of them across twenty, 10 across cal.com.
//
// Two ways to fix that are wrong, and both were tried before this file existed:
//
//  1. Gate the whole builder rule on `dbHandles`. That deletes REAL writes in
//     every module whose handle the collector cannot label.
//  2. Return from `inspectCall` when the root is proven crypto. That is not a
//     narrower rule, it is a SILENCE: every later rule — active-record, Mongo
//     collection, opaque persistence — is skipped for that call too, so a route
//     that does touch the database can end up with no effect at all.
//
// The refusal has to be LOCAL to the rule that got it wrong: `builderTableOf`
// declines to name a table, and nothing else changes. And the exclusion is by
// ORIGIN, never by text — a `createHash` that is also declared locally could be
// shadowed at the call site, so it falls back to UNRESOLVED and the effect is
// still surfaced.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const effectsOf = (fixture) => {
  const { graph } = compileUBG(path.join(here, 'fixtures', fixture), { write: false });
  return canonicalizeGraph(graph).nodes.filter((n) => n.kind === 'effect');
};
const tablesOf = (effects) => effects.map((n) => n.meta.table);

const imported = effectsOf('node-crypto-not-a-table');
const shadowed = effectsOf('node-crypto-shadowed');

describe('a digest algorithm is not a table', () => {
  it('`import { createHash } from "node:crypto"` yields no DB effect', () => {
    // the algorithm strings of the fixture, which used to be table names
    expect(tablesOf(imported)).not.toContain('sha256');
    expect(tablesOf(imported)).not.toContain('md5');
  });

  it('a destructured — and RENAMED — `require("node:crypto")` is the same binding', () => {
    // `const { createHash: sha } = require('node:crypto')`, then `sha('sha256')`.
    // Matching on the imported NAME would miss this; the binding is what counts.
    expect(tablesOf(shadowed)).not.toContain('sha256');
    expect(tablesOf(shadowed)).not.toContain('sha512');
  });

  it('a real builder write on the SAME path still lands', () => {
    // `db('users').update({ digest: createHash('md5')... })` — the crypto value
    // flows INTO the write, and the write must survive intact.
    expect(tablesOf(imported)).toContain('users');
    expect(tablesOf(shadowed)).toContain('users');
  });

  it('a builder write with no crypto anywhere near it is untouched', () => {
    expect(tablesOf(imported)).toContain('audit_log');
  });

  it('every surviving effect names a table or admits it has none', () => {
    // rule 13, at the grain of one effect: a write with no table is `null` and
    // `opaque`, never a plausible-looking string nobody can check.
    for (const node of [...imported, ...shadowed]) {
      if (node.meta.table == null) expect(node.meta.opaque).toBe(true);
      else expect(typeof node.meta.table).toBe('string');
    }
  });
});

describe('the exclusion is by origin, never by name', () => {
  it('a locally shadowed `createHash` is NOT excluded — it stays unresolved', () => {
    // `shadow.js` imports `createHash` from node:crypto AND re-declares it as a
    // query builder inside `seal`. The module cannot tell which declaration a
    // reference resolves to, so the name is dropped from the proven-non-DB set
    // and the effect is emitted. Excluding it by text would erase this write.
    expect(tablesOf(shadowed)).toContain('audit_trail');
  });
});

describe('the refusal is local to the builder rule', () => {
  it('a crypto call whose receiver holds a DB handle still surfaces', () => {
    // `sha(db.userParams.algo).update(...)` — `builderTableOf` declines because
    // the root is proven crypto, and the conservative opaque-write rule then
    // catches the call because the receiver mentions a persistence handle.
    // Returning from `inspectCall` instead skips that rule and leaves ONE of
    // these two, which is the mutant this assertion exists to kill.
    const opaque = shadowed.filter((n) => n.meta.opaque === true && n.meta.table == null);
    expect(opaque).toHaveLength(2);
    for (const node of opaque) expect(node.meta.effectType).toBe('db_write');
  });
});
