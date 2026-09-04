// G1 `ownerAsserted` — a value the CLIENT supplied never proves caller-ownership.
//
// The shape that made this a real defect: a Mongo filter document
// `{ userId: parsedUserId }` is syntactically identical to an ownership
// assertion — an ownership-named key bound to a plain identifier. Measured on
// NodeGoat, the filter of the labelled IDOR route was read as PROOF AGAINST the
// IDOR and silenced its own advisory. The shape only became reachable once the
// DAO layer resolved, which is why no earlier session saw it.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph } = compileUBG(path.join(here, 'fixtures', 'kernel-owner-asserted'), {
  write: false,
});
const entry = (id) => [...graph.nodes.values()].find((n) => n.id === id);

describe('an ownership assertion cannot be built from client input', () => {
  it('refuses the assertion when the id came from req.params', () => {
    // Same DAO method, same filter shape, same ownership-named key — the ONLY
    // difference is where the value came from, and that is the whole question.
    expect(entry('entrypoint:GET /docs/user/:userId').meta.ownerAsserted).toBeUndefined();
  });

  it('keeps the assertion when the id came from the session', () => {
    // Not a rule that simply stopped firing: the session twin still asserts.
    expect(entry('entrypoint:GET /docs/mine').meta.ownerAsserted).toBe(true);
  });
});
