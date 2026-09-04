// bench/soundness/fingerprint.mjs — a source pin that survives a checkout.
//
// THE DEFECT THIS EXISTS FOR. `truth.json` pinned each labelled source file by
// the sha256 of its WORKING-TREE bytes. Git rewrites line endings on checkout
// (`core.autocrlf`, `.gitattributes`, platform defaults), so those bytes are a
// property of the machine that ran `git checkout`, not of the commit. The
// existing pins were computed on a CRLF checkout and do not verify on an LF one:
// reproducing the baseline required setting `core.autocrlf=true` on every clone,
// which is exactly the hidden local setting a reproducibility gate must not need.
//
// THE FIX, AND ITS HONEST COST. The portable fingerprint hashes the file with
// line endings NORMALISED to LF. That is a deliberate, documented weakening: two
// files differing only in line endings now share a fingerprint. It is the right
// trade because git itself does not consider that difference content — it
// rewrites it at will — so a pin that distinguishes them pins the checkout, not
// the source. Everything else (every byte that is not a CR before an LF) is still
// compared exactly.
//
// WHAT IT DOES NOT DO. It does not replace the commit pin. `origin.commit` is
// still the primary identity of the source; the per-file fingerprint exists to
// catch a working tree that drifted from it.
import crypto from 'node:crypto';
import fs from 'node:fs';

export const FINGERPRINT_VERSION = 'sparda-source-fingerprint/v1';

// CRLF → LF, and a lone CR (classic Mac, and what a mangled merge leaves behind)
// → LF as well. Applied to BYTES, not to a decoded string: a file that is not
// valid UTF-8 must still fingerprint deterministically rather than throw or pass
// through a replacement character.
export function normalizeLineEndings(buffer) {
  const out = Buffer.alloc(buffer.length);
  let length = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (byte === 0x0d) {
      // CR: swallow it, and swallow a following LF so CRLF collapses to one LF
      if (buffer[i + 1] === 0x0a) i += 1;
      out[length] = 0x0a;
      length += 1;
      continue;
    }
    out[length] = byte;
    length += 1;
  }
  return out.subarray(0, length);
}

export const portableFingerprintOf = (buffer) =>
  crypto.createHash('sha256').update(normalizeLineEndings(buffer)).digest('hex');

export const portableFingerprintOfFile = (file) =>
  portableFingerprintOf(fs.readFileSync(file));

// The legacy pin: raw working-tree bytes. Kept so a case that has not been
// migrated is still checked rather than skipped — a pin nobody verifies is worse
// than a pin that only verifies on one platform.
export const rawFingerprintOfFile = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Verify one pinned source file. The result is a three-state on purpose:
//
//   'portable' — the portable fingerprint matched. Reproducible anywhere.
//   'legacy'   — no portable fingerprint is recorded, and the raw bytes matched.
//                True on this platform, unproven on any other.
//   'mismatch' — a recorded fingerprint did not match. Always a failure.
//
// `unmeasured` is NOT one of them: a file that cannot be read is a mismatch, and
// a case with no fingerprint at all is rejected by `validateCases`.
export function verifySource(file, pin) {
  if (!fs.existsSync(file)) return { status: 'mismatch', reason: 'missing file' };
  const buffer = fs.readFileSync(file);
  if (pin.fingerprint) {
    const actual = portableFingerprintOf(buffer);
    return actual === pin.fingerprint
      ? { status: 'portable', actual }
      : { status: 'mismatch', actual, reason: 'portable fingerprint changed' };
  }
  const actual = crypto.createHash('sha256').update(buffer).digest('hex');
  return actual === pin.sha256
    ? { status: 'legacy', actual }
    : {
        status: 'mismatch',
        actual,
        reason:
          'raw byte pin changed — this pin is platform-dependent, so a line-ending difference alone can cause it',
      };
}
