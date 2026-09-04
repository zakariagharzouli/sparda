// flask-nested-entry.test.js — the entry SPARDA picks is the one the framework uses (E-115).
//
// `searchPyFiles(dir, root, countRef, marker)` recursed WITHOUT forwarding `marker`, so every
// subdirectory was searched for the default `'FastAPI('` no matter what the caller asked for. The
// bug is asymmetric by construction: `findFastAPIEntry` passes the default and worked by accident,
// while `findFlaskEntry` — the only caller with a non-default marker — lost it at the first
// directory boundary.
//
// Two failures came out of one line, and the second is the one that matters:
//
//   1. LOUD — a Flask app whose `Flask(__name__)` is in a subdirectory: "Could not locate your
//      Flask entry file". SPARDA refuses to analyse a valid app. Safe direction, visible.
//   2. SILENT — a tree containing both a FastAPI file and a Flask file: `findFlaskEntry` returned
//      the FASTAPI file as the Flask entry. SPARDA then compiled the wrong file, so the real
//      routes were never in the graph: no error, no blind spot, no premise gap, because nothing
//      knew a different file existed. That is Direction 3 — the analysed set silently is not the
//      real set — reached through entry DETECTION rather than through extraction.
//
// The second case is why this test exists at the fixture level rather than as a unit test on the
// finder: what has to hold is that the compiled graph is about the app, and that only shows when
// the whole detection path runs.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../src/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (n) => path.join(here, 'fixtures', n);

describe('Flask entry detection recurses with the marker it was asked for (E-115)', () => {
  it('finds a Flask entry that lives in a subdirectory under a non-candidate name', () => {
    const s = detectStack(fix('flask-nested-entry'));
    expect(s.framework).toBe('flask');
    expect(s.entryFile).toBe('sub/web.py');
  });

  it('does NOT return a FastAPI file as the Flask entry when both are present', () => {
    // The silent case. `sub/api.py` sorts before `sub/web.py`, so the old code found it first
    // and stopped — and everything downstream was about the wrong file.
    const s = detectStack(fix('flask-nested-with-fastapi'));
    expect(s.framework).toBe('flask');
    expect(s.entryFile).toBe('sub/web.py');
    expect(s.entryFile).not.toBe('sub/api.py');
  });

  it('and the FastAPI finder, which passes the default marker, is unaffected', () => {
    // The asymmetry stated as a test: the default-marker caller always worked, so a fix that
    // broke it would be trading one bug for another.
    const s = detectStack(fix('ubg-fastapi'));
    expect(s.framework).toBe('fastapi');
    expect(s.entryFile).toMatch(/\.py$/);
  });
});
