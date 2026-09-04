// A Nest route decorator's path is often forced at build time and still unreadable:
// `@Get(`${ROOT}/things`)` is exactly one URL, but the lowering tested for
// `StringLiteral` and found none, so the route was placed at the controller prefix
// and the doubt declared.
//
// Measured on the Lab probe against Core `5f490a8`, before this change:
// two handlers, two entrypoints at `/`, two `dynamic path` declarations. After:
// `/api/v3/things`, `/api/v3/things`, `/api/v3/things/:id`, zero declarations.
//
// This improves ONE thing — which URL a handler already found is served at. It may
// not credit a guard, an owner, a validation, a DB effect, a finding or a verdict.
// And the grammar is closed: everything outside it stays exactly as unresolved as
// it was, because a made-up URL is worse than an admitted one.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { graph, report } = compileUBG(
  path.join(here, 'fixtures', 'nest-static-route-paths'),
  { write: false },
);
const g = canonicalizeGraph(graph);
const routes = g.nodes
  .filter((n) => n.kind === 'entrypoint')
  .map((n) => n.id)
  .sort();
const skips = (report.skipped ?? []).map((s) => s.reason);
const declaredFor = (controller) =>
  skips.filter((r) => r.includes(controller) && r.startsWith('dynamic path'));

describe('the V1 grammar — every accepted form', () => {
  it('1 — a plain string literal still works', () => {
    expect(routes).toContain('entrypoint:GET /plain');
  });

  it('2 — an array is ONE decorator registering TWO routes', () => {
    expect(routes).toContain('entrypoint:POST /api/v3/things');
    expect(routes).toContain('entrypoint:POST /api/v3/things/:id');
  });

  it('3 & 5 — a template literal over an ALIASED named import', () => {
    // `import { API as ROOT }` then `@Get(`${ROOT}/things`)`. Matching the local
    // name against the export would read the wrong binding, or none.
    expect(routes).toContain('entrypoint:GET /api/v3/things');
  });

  it('4 — a program-scope const declared in the controller module', () => {
    expect(routes).toContain('entrypoint:GET /local/health');
  });

  it('5b — an imported const whose own initializer is a template over another const', () => {
    // `ADMIN = `${API}/admin`` — the chain resolves across two bindings in the
    // imported module, not just one hop
    expect(routes).toContain('entrypoint:GET /api/v3/admin');
  });

  it('the same const twice in one template is a repeat, not a cycle', () => {
    // the cycle guard is per-branch on purpose: sibling interpolations that read
    // the same binding are not a loop, and treating them as one loses a real URL
    expect(routes).toContain('entrypoint:GET /twice/twice');
  });

  it('a resolved path leaves NO declared boundary behind', () => {
    // the doubt must go away when it is genuinely answered, or the ledger stops
    // meaning anything
    expect(declaredFor('PositiveController')).toEqual([]);
  });
});

describe('every rejection stays unknown — and DECLARED', () => {
  const negatives = [
    ['a mutable `let` binding', 'MutableController'],
    ['an external package import', 'ExternalController'],
    ['a `process.env` read', 'EnvironmentController'],
    ['a call expression and a property read', 'CallController'],
    ['a cycle between two constants', 'CycleController'],
    ['a module the resolver cannot open', 'UnresolvedController'],
    ['a named import of a module-PRIVATE const', 'PrivateController'],
    ['an array with one unreadable element', 'PartialController'],
  ];

  for (const [title, controller] of negatives)
    it(`${title} — declared, never resolved`, () => {
      expect(declaredFor(controller).length, controller).toBeGreaterThan(0);
    });

  it('no rejected form invents a URL', () => {
    // Each negative controller's path would have been `/mutable/things`,
    // `/cfg/things`, and so on had the grammar guessed. None of them may exist.
    for (const invented of [
      'entrypoint:GET /mutable/things',
      'entrypoint:GET /built',
      'entrypoint:POST /cfg/things',
      'entrypoint:GET /things',
      'entrypoint:GET /undefined/things',
      'entrypoint:GET /hidden/things',
    ])
      expect(routes).not.toContain(invented);
  });

  it('a partial array registers NOTHING — a lost route is worse than an unknown one', () => {
    // `@Post([KNOWN, process.env.OTHER_PATH])`. Taking the half that reads would
    // publish one URL and silently delete the other, with the doubt cleared.
    expect(routes).not.toContain('entrypoint:POST /partial/known');
  });

  it('a rejected route still EXISTS, at the controller prefix', () => {
    // the behaviour is real; only its URL is unknown. Losing the route would be
    // the registration invariant's failure, which is worse than a wrong path.
    expect(routes).toContain('entrypoint:GET /');
    expect(routes).toContain('entrypoint:POST /');
  });

  it('a cycle terminates instead of exhausting the stack', () => {
    // two constants importing each other; the guard is what makes this a test
    // rather than a crash
    expect(declaredFor('CycleController')).toHaveLength(1);
  });
});

describe('route-path precision improves visibility and nothing else', () => {
  it('credits no guard', () => {
    // the fixture declares no guard anywhere; a precise path may never conjure one
    expect(g.nodes.filter((n) => n.kind === 'guard')).toEqual([]);
  });

  it('creates no DB effect and no finding surface of its own', () => {
    expect(g.nodes.filter((n) => n.kind === 'effect')).toEqual([]);
  });

  it('every route is still an ordinary entrypoint node', () => {
    for (const id of routes) expect(id).toMatch(/^entrypoint:[A-Z]+ \//);
  });
});
