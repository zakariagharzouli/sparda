// A collection name that is not a literal is a target expressed as a RULE, never
// a target we invented. The distinction is load-bearing in both directions:
//
//   • the write itself must still be recorded — dropping it would hide a real
//     mutation and let the route read clean (SOUNDNESS Direction 3);
//   • the table must stay `null` with `symbolicTarget: true` — naming it would
//     fabricate a state node, and every table-keyed rule downstream (O2/O3,
//     ownership inference) would reason against a collection that does not exist.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('kernel — a target it cannot read is never invented', () => {
  const { report, graph } = compileUBG(
    path.join(here, 'fixtures', 'node-kernel-symbolic'),
    { write: false },
  );

  it('records the write but refuses to name the collection', () => {
    const effects = report.kernel.facts.filter((f) => f.kind === 'DbEffect');
    expect(effects).toHaveLength(1);
    const [effect] = effects;
    expect(effect.access).toBe('write');
    expect(effect.op).toBe('insert');
    // The two assertions that matter, together: present as a write, unnamed as a target.
    expect(effect.table).toBeNull();
    expect(effect.symbolicTarget).toBe(true);
  });

  it('raises a dynamic-target boundary, not just a blank field', () => {
    // A target we could not read is a STOP. Carrying it only inside the effect's
    // provenance would hide it from anyone auditing "what did SPARDA not see?".
    const boundaries = report.kernel.facts.filter((f) => f.kind === 'UnknownBoundary');
    expect(boundaries.some((f) => f.provenance.uncertainty === 'dynamic-target')).toBe(
      true,
    );
    expect(report.kernel.complete).toBe(false);
  });

  it('creates no state node for a collection nobody could name', () => {
    const invented = [...graph.nodes.values()].filter(
      (node) => node.kind === 'state' && /unknown|undefined|null/i.test(node.id),
    );
    expect(invented).toEqual([]);
  });
});
