import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { createGraph, makeNode, addNode } from '../src/ubg/schema.js';
import { optimize } from '../src/ubg/pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'ubg-fabric-conservation');

describe('Fabric F1 conservation certificates', () => {
  it('certifies translation, linking, and every pipeline pass on a real fixture', () => {
    const compiled = compileUBG(fixture, { write: false });
    const translate = compiled.graph.meta.conservation.translate;

    expect(translate.balance.balanced).toBe(true);
    expect(translate.invariantsPreserved).toContain('all-facts-accounted');
    expect(
      translate.nodesIntroduced.some((fact) => fact.id.startsWith('node:entrypoint:')),
    ).toBe(true);
    expect(compiled.report.link.conservation.balance.balanced).toBe(true);
    expect(compiled.report.passes).toHaveLength(8);
    expect(
      compiled.report.passes.every((pass) => pass.conservation.balance.balanced),
    ).toBe(true);
  });

  it('rejects a pass that drops a graph fact without a declared loss or merge', () => {
    const graph = createGraph({ framework: 'fixture' });
    addNode(graph, makeNode('logic:fixture#live:1', 'logic', 'live'));

    expect(() =>
      optimize(graph, {
        passes: [
          {
            name: 'SilentLoss',
            run(current) {
              current.nodes.delete('logic:fixture#live:1');
              return {};
            },
          },
        ],
      }),
    ).toThrow(/disappeared without classification/);
  });
});
