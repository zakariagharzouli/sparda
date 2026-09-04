// E-118 — settling is not draining.
//
// `tests/probe.test.js` asserts that the probe carries the app's OWN error out.
// That assertion failed intermittently, and the cause was not the test: calling
// `probeRoutes` directly, with no test framework involved, lost the bytes 2-3
// times in 12 under CPU load and 0 times in 8 idle.
//
// The mechanism, measured rather than reasoned: `express-shim.cjs` registers
// `process.on('exit', sendDone)`, so an app that writes its error and calls
// `process.exit(1)` sends `__done__` over the IPC channel while its stderr bytes
// are still travelling down a different pipe. The parent settled on the message
// and read `stderrTail` before the `data` callback had run. E-110 had moved the
// settle from `exit` to `close` and called the race fixed — it fixed one of the
// four ways to stop, and not the one that fires.
//
// This file pins the drain itself, DETERMINISTICALLY. The integration test in
// `probe.test.js` is the witness that the product behaves; a race cannot be a
// reliable mutant killer, so the invariant is unit-tested here instead.
import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterDrain, DRAIN_GRACE_MS } from '../src/probe/probe.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('afterDrain — the diagnostic is built after the bytes have arrived', () => {
  it('WAITS: done is not called while the stream is still open', async () => {
    // THE killing assertion. Remove the wait and `done` fires immediately, which
    // is exactly the defect: `stderrTail` read before the last chunk landed.
    const s = new PassThrough();
    s.resume();
    let called = false;
    afterDrain(s, DRAIN_GRACE_MS, () => {
      called = true;
    });
    s.write('FATAL: connect ECONNREFUSED 127.0.0.1:5432\n');
    await new Promise((r) => setImmediate(r));
    expect(called, 'settled before the stream ended').toBe(false);

    s.end();
    await new Promise((r) => setImmediate(r));
    expect(called, 'never settled after the stream ended').toBe(true);
  });

  it('every byte written before `end` has been delivered by the time it fires', () => {
    // The property the fix buys, stated as the consumer sees it: `end` is emitted
    // after every `data`, so a reader that waits for `end` cannot observe a
    // partial tail.
    const s = new PassThrough();
    let tail = '';
    s.on('data', (c) => {
      tail += String(c);
    });
    let seen = null;
    afterDrain(s, DRAIN_GRACE_MS, () => {
      seen = tail;
    });
    s.write('FATAL: ');
    s.write('connect ECONNREFUSED');
    s.end();
    return new Promise((r) => setImmediate(r)).then(() => {
      expect(seen).toBe('FATAL: connect ECONNREFUSED');
    });
  });

  it('an already-finished stream costs nothing — done is synchronous', () => {
    let called = false;
    afterDrain(null, DRAIN_GRACE_MS, () => {
      called = true;
    });
    expect(called).toBe(true);

    const s = new PassThrough();
    s.resume();
    s.end();
    return new Promise((r) => setImmediate(r)).then(() => {
      let second = false;
      afterDrain(s, DRAIN_GRACE_MS, () => {
        second = true;
      });
      expect(second).toBe(true);
    });
  });

  it('the wait is BOUNDED — a stream that never ends still settles', async () => {
    // A live app's stderr never ends on its own. The grace is the declared cap on
    // how long we wait for bytes that may never come; without it the probe would
    // hang instead of reporting.
    const s = new PassThrough();
    s.resume();
    let called = false;
    afterDrain(s, 20, () => {
      called = true;
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(called).toBe(true);
  });

  it('done runs exactly once, however the stream finishes', async () => {
    const s = new PassThrough();
    s.resume();
    let n = 0;
    afterDrain(s, DRAIN_GRACE_MS, () => {
      n += 1;
    });
    s.end();
    s.destroy();
    await new Promise((r) => setTimeout(r, 40));
    expect(n).toBe(1);
  });

  it('`end` is listened for in its OWN right, not left to `close`', async () => {
    // `close` is not a substitute. It fires on DESTROY, which can happen without
    // `end` ever being reached — and a stream destroyed mid-flight is precisely
    // the case where bytes were lost. A PassThrough with `emitClose: false`
    // never emits `close`, so only an `end` listener can settle this promptly;
    // without one the grace cap would be the only way out.
    const s = new PassThrough({ emitClose: false });
    s.resume();
    let called = false;
    afterDrain(s, 5000, () => {
      called = true;
    });
    s.write('FATAL: connect ECONNREFUSED\n');
    s.end();
    await new Promise((r) => setImmediate(r));
    expect(called, 'settled only via the grace cap, not via `end`').toBe(true);
  });

  it('the drain is WIRED into settle, not merely available beside it', () => {
    // A wiring property, and E-106 is what it costs to test one by running a
    // command: four call sites stayed unwired under a green suite. So it is a
    // SOURCE rule, with a vacuity check, exactly as SOUNDNESS 3e prescribes.
    const src = fs.readFileSync(
      path.join(here, '..', 'src', 'probe', 'probe.js'),
      'utf8',
    );
    // vacuity: the thing the rule is about must still exist
    expect(src).toContain('function settle(result)');
    expect(src).toContain('export function afterDrain(');
    const body = src.slice(src.indexOf('function settle(result)'));
    const end = body.indexOf('\n    }');
    expect(body.slice(0, end)).toContain('afterDrain(child?.stderr, DRAIN_GRACE_MS');
  });

  it('the grace is a named, reviewable bound', () => {
    expect(typeof DRAIN_GRACE_MS).toBe('number');
    expect(DRAIN_GRACE_MS).toBeGreaterThan(0);
  });
});
