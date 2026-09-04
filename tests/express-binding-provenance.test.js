// Express object provenance — a local function called `express` is not the package.
//
// `flattenSetup` intentionally opens setup-function bodies. Its former app/router
// table was keyed only by identifier text, so a nested fake `express()` polluted the
// module-wide table and manufactured routes and effects. This suite requires the
// binding identity and its package origin to survive that flattening.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { extractExpress } from '../src/ubg/express.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (...parts) => path.join(here, 'fixtures', ...parts);
const target = fixture('ubg-express-binding-provenance');

const compiled = (() => {
  const { graph, report } = compileUBG(target, { write: false });
  return { graph: canonicalizeGraph(graph), report };
})();

const labels = (graph) =>
  graph.nodes.filter((node) => node.kind === 'entrypoint').map((node) => node.label);

describe('Express app/router lexical provenance', () => {
  it('keeps routes whose receiver descends from the official Express binding', () => {
    expect(labels(compiled.graph)).toEqual(['GET /kept-alias', 'POST /kept-router']);
  });

  it('does not manufacture routes from shadowed factory, app or Router bindings', () => {
    expect(labels(compiled.graph)).not.toEqual(
      expect.arrayContaining(['/masked-factory', '/masked-app', '/masked-router']),
    );
  });

  it('does not attach effects that exist only behind the fabricated routes', () => {
    const tables = compiled.graph.nodes
      .filter((node) => node.kind === 'effect' && node.meta.effectType === 'db_write')
      .map((node) => node.meta.table);
    expect(tables).toContain('kept_rows');
    expect(tables).not.toEqual(
      expect.arrayContaining([
        'masked_factory_rows',
        'masked_app_rows',
        'masked_router_rows',
        'ambiguous_rows',
        'ambiguous_chain_rows',
      ]),
    );
  });

  it('declares a reassigned proven app as UNKNOWN instead of trusting either value', () => {
    expect(labels(compiled.graph)).not.toContain('POST /ambiguous-reassignment');
    expect(compiled.report.unknownHandlers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'UnknownHandler',
          via: 'ambiguous-express-binding',
          target: 'mutableApp',
        }),
        expect.objectContaining({
          kind: 'UnknownHandler',
          via: 'ambiguous-express-binding',
          target: 'chainedApp',
        }),
      ]),
    );
    expect(
      compiled.report.skipped.some(
        (entry) => entry.risk === 'high' && /mutableApp/.test(entry.reason),
      ),
    ).toBe(true);
  });

  it('preserves existing ESM, CommonJS and TypeScript import-equals forms', () => {
    const cases = [
      ['express-hostile', 'src/app.js', ['GET /api/danger']],
      ['ubg-express', 'src/app.js', ['GET /users/:id', 'POST /users']],
      ['express-ts-cjs', 'src/app.ts', ['GET /api/users/:id', 'GET /health']],
    ];
    for (const [name, entry, expected] of cases) {
      const out = extractExpress(fixture(name), entry);
      expect({
        name,
        routes: out.routes.map((route) => `${route.method.toUpperCase()} ${route.path}`),
      }).toEqual(
        expect.objectContaining({ name, routes: expect.arrayContaining(expected) }),
      );
    }
  });

  it('emits byte-identical canonical evidence across independent compilations', () => {
    const first = compileUBG(target, { write: false });
    const second = compileUBG(target, { write: false });
    expect(
      JSON.stringify({ graph: canonicalizeGraph(first.graph), report: first.report }),
    ).toBe(
      JSON.stringify({ graph: canonicalizeGraph(second.graph), report: second.report }),
    );
  });
});
