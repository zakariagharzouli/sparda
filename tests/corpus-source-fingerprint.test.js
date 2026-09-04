// A source pin must identify the SOURCE, not the checkout.
//
// The defect: `truth.json` pinned each labelled file by the sha256 of its
// working-tree bytes, and git rewrites line endings on checkout. Reproducing the
// benchmark baseline therefore required `core.autocrlf=true` on every clone — a
// hidden local setting, which is precisely what a reproducibility gate must not
// depend on.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeLineEndings,
  portableFingerprintOf,
  portableFingerprintOfFile,
  verifySource,
} from '../bench/soundness/fingerprint.mjs';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SOURCE_LF = ['const a = 1;', 'if (a) {', '  log(a);', '}', ''].join(LF);
const SOURCE_CRLF = SOURCE_LF.split(LF).join(CR + LF);
const rawHash = (value) =>
  crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');

describe('the same source in CRLF and in LF has the same portable fingerprint', () => {
  it('CRLF === LF', () => {
    // The whole point of this file, in one assertion.
    expect(portableFingerprintOf(Buffer.from(SOURCE_CRLF, 'utf8'))).toBe(
      portableFingerprintOf(Buffer.from(SOURCE_LF, 'utf8')),
    );
  });

  it('and the RAW byte pin does not — which is the defect being repaired', () => {
    // Without this assertion the one above could pass on a fingerprint that
    // simply ignores everything, and the test would prove nothing.
    expect(rawHash(SOURCE_CRLF)).not.toBe(rawHash(SOURCE_LF));
  });

  it('holds through a real round-trip on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-fp-'));
    const lf = path.join(dir, 'lf.js');
    const crlf = path.join(dir, 'crlf.js');
    fs.writeFileSync(lf, SOURCE_LF);
    fs.writeFileSync(crlf, SOURCE_CRLF);
    expect(portableFingerprintOfFile(crlf)).toBe(portableFingerprintOfFile(lf));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a lone CR normalises too — a mangled merge must not change the identity', () => {
    expect(portableFingerprintOf(Buffer.from('a' + CR + 'b', 'utf8'))).toBe(
      portableFingerprintOf(Buffer.from('a' + LF + 'b', 'utf8')),
    );
  });
});

describe('normalisation changes ONLY line endings', () => {
  it('leaves every other byte alone', () => {
    // The weakening is deliberate and bounded: if it went further it would stop
    // being a content pin at all.
    const payload = Buffer.from('a\tb  cé d' + LF, 'utf8');
    expect(normalizeLineEndings(payload)).toEqual(payload);
  });

  it('still separates two files that differ in content', () => {
    expect(portableFingerprintOf(Buffer.from('a = 1' + LF))).not.toBe(
      portableFingerprintOf(Buffer.from('a = 2' + LF)),
    );
  });

  it('handles non-UTF-8 bytes without throwing or lossy decoding', () => {
    const binary = Buffer.from([0xff, 0xfe, 0x0d, 0x0a, 0x00]);
    expect(portableFingerprintOf(binary)).toBe(
      portableFingerprintOf(Buffer.from([0xff, 0xfe, 0x0a, 0x00])),
    );
  });
});

describe('verifySource reports which KIND of proof it had', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-verify-'));
  const file = path.join(dir, 'src.js');
  fs.writeFileSync(file, SOURCE_CRLF);

  it('portable when a portable fingerprint is recorded and matches', () => {
    const result = verifySource(file, {
      fingerprint: portableFingerprintOf(Buffer.from(SOURCE_LF, 'utf8')),
    });
    expect(result.status).toBe('portable');
  });

  it('LEGACY — not "portable" — when only a raw byte pin exists', () => {
    // A legacy pin is true on this platform and unproven on any other. Calling
    // that "portable" would be the same lie one layer down.
    expect(verifySource(file, { sha256: rawHash(SOURCE_CRLF) }).status).toBe('legacy');
  });

  it('mismatch when a recorded fingerprint does not match', () => {
    expect(verifySource(file, { fingerprint: 'deadbeef' }).status).toBe('mismatch');
    expect(verifySource(file, { sha256: 'deadbeef' }).status).toBe('mismatch');
  });

  it('a missing file is a mismatch, never a pass', () => {
    expect(verifySource(path.join(dir, 'nope.js'), { fingerprint: 'x' }).status).toBe(
      'mismatch',
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
