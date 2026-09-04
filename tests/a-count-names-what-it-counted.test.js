// a-count-names-what-it-counted.test.js — E-117.
//
// `routes: 0` invites the reader to conclude something about their APP. The only thing
// SPARDA measured is one FILE, and those two sentences diverge exactly when entry
// detection picked the wrong one — the case with no other symptom. Reproduced in the
// wild: a Flask project holding a stray `FastAPI(` file produced
// `{"verdict":"NO_PROOF","routes":0}` — well-formed JSON, a legitimate verdict word,
// empty stderr, exit 1 like any other verdict. A consuming pipeline recorded it as a
// measurement of the app, and the conclusion drawn from it was "SPARDA cannot read
// Python" for a framework SPARDA reads fine.
//
// So the subject of the count travels WITH the count: `framework` and `entry` are stated
// before the verdict, and the zero-route line names the file that produced the zero.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProve } from '../src/commands/prove.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(here, 'fixtures', name);

function capture(run) {
  const lines = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((...a) => lines.push(a.join(' ')));
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  return run()
    .then(() => ({ out: lines.join('\n'), exit: process.exitCode }))
    .finally(() => {
      spy.mockRestore();
      process.exitCode = prevExit;
    });
}

const proveJson = async (name) => {
  const { out } = await capture(() => runProve({ cwd: fix(name), json: true }));
  return JSON.parse(out);
};

describe('E-117 — a count states what it counted', () => {
  it('prove --json names the framework and the entry file, BEFORE the verdict', async () => {
    const json = await proveJson('ubg-flask');
    expect(json.framework).toBe('flask');
    expect(json.entry).toBe('app.py');
    expect(json.routes).toBe(4);
    // Order is load-bearing, not cosmetic: a reader (or an LLM summarising the dossier)
    // takes the first fields as the frame for everything after them. The subject has to
    // arrive before the number it is the subject of.
    const keys = Object.keys(json);
    expect(keys.indexOf('framework')).toBeLessThan(keys.indexOf('verdict'));
    expect(keys.indexOf('entry')).toBeLessThan(keys.indexOf('routes'));
  });

  it('every framework the compiler lowers reports its own entry, not a default', async () => {
    // A single-fixture assertion would pass on a hard-coded string. Two frameworks with
    // two different entry shapes (a Python module, a JS file) pin that the value is read
    // from the detection rather than invented.
    expect(await proveJson('ubg-flask')).toMatchObject({
      framework: 'flask',
      entry: 'app.py',
    });
    expect(await proveJson('ubg-proven')).toMatchObject({
      framework: 'express',
      entry: 'src/app.js',
    });
  });

  it('the zero-route verdict names the file that produced the zero', async () => {
    // The one case that lies is the one that must speak. Without this line, "0 routes
    // resolved" is unfalsifiable by the person reading it.
    const { out } = await capture(() => runProve({ cwd: fix('ubg-broken-entry') }));
    expect(out).toMatch(/NO PROOF/);
    expect(out).toMatch(/0 routes resolved/);
    expect(out).toMatch(/analysed as express, entry: src\/app\.js/);
  });

  it('the zero-route JSON carries it too — a pipeline reads JSON, not the banner', async () => {
    // E-106's lesson, applied here: a field that only the human surface carries is a
    // field the consumer that actually got fooled will never see.
    const json = await proveJson('ubg-broken-entry');
    expect(json.verdict).toBe('NO_PROOF');
    expect(json.routes).toBe(0);
    expect(json.framework).toBe('express');
    expect(json.entry).toBe('src/app.js');
  });
});
