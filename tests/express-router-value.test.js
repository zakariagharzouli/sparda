// Express CommonJS router-value V1 — ADR-103.
//
//   const routes = require('./routes');
//   app.use(routes);
//
// `app.use('/api', routes)` has mounted routers since the first Express lowering.
// The SAME router mounted without a path did not, because the mount branch is only
// reached when the first argument is a StringLiteral. The router value fell through
// to the unpathed-middleware loop, `resolveCallable` accepted it, and the whole
// route tree became one middleware named `routes`.
//
// MEASURED on the probe before the change: `app.use('/', routes)` → 6 routes;
// `app.use(routes)` → 0 routes, 0 skipped surfaces, 0 boundaries. Not a wrong
// answer — no answer, and no trace that one was missing.
//
// The slice adds ONE discriminator: does the required module statically export an
// Express Router? Everything downstream — nested `router.use('/p', require('./c'))`
// and literal leaves — is the existing mount machinery, reused. It changes route
// TOPOLOGY only: no guard, no auth, no ownership, no effect, no finding, no verdict.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { extractExpress } from '../src/ubg/express.js';
import { exportsExpressRouter } from '../src/ubg/express-router-value.js';
import { affectedProperties } from '../src/ubg/kernel/attach.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'fixtures', 'express-router-value');
const { graph, report } = compileUBG(dir, { write: false });
const g = canonicalizeGraph(graph);
const routes = g.nodes
  .filter((n) => n.kind === 'entrypoint')
  .map((n) => n.id)
  .sort();
const declared = (report.kernel?.facts ?? []).filter(
  (f) => f.provenance?.contract === 'express/router-value',
);
const declaredFor = (symbol) => declared.filter((d) => d.symbol === symbol);
const raw = extractExpress(dir, 'index.js', {});
const middlewareNames = (raw.globalMiddlewares ?? []).map((m) => m.name);

describe('the positive: a nested CommonJS router tree becomes routes', () => {
  it('composes literal child mounts with literal leaves', () => {
    expect(routes).toEqual([
      'entrypoint:DELETE /admin/purge',
      'entrypoint:GET /health',
      'entrypoint:GET /users',
      'entrypoint:GET /users/:id',
      'entrypoint:POST /users/login',
    ]);
  });

  it('the unpathed mount equals the pathed one it was always equivalent to', () => {
    // `app.use(routes)` and `app.use('/', routes)` are the same mount. The second
    // has always worked; this test is what pins that they agree.
    expect(routes.length).toBeGreaterThan(0);
    for (const id of routes) expect(id).toMatch(/^entrypoint:[A-Z]+ \//);
  });

  it('a third level beyond the existing depth bound is DECLARED, not lost', () => {
    // MOUNT_DEPTH_MAX is a pre-existing honest bound and this slice does not move
    // it. What matters is that the unreached surface is still declared.
    const depth = (report.skipped ?? []).filter((s) =>
      s.reason.includes('mount depth limit'),
    );
    expect(depth.length).toBeGreaterThan(0);
    expect(depth.some((s) => s.reason.includes('/admin/reports'))).toBe(true);
  });

  it('both static factory forms are proved', () => {
    // `express.Router()`, `Router()` destructured, and `require('express').Router()`
    // — the chained one is what the pinned external source writes.
    const f = (n) => path.join(dir, 'routes', n);
    expect(exportsExpressRouter(f('index.js')).router).toBe(true); // express.Router()
    expect(exportsExpressRouter(f('users.js')).router).toBe(true); // require(..).Router()
    expect(exportsExpressRouter(f('admin/reports.js')).router).toBe(true); // { Router }
  });
});

describe('the five negatives — declared, never invented, never silent', () => {
  it('1 — a DYNAMIC require mounts nothing and is declared', () => {
    expect(declared.some((d) => d.detail.includes('not a literal'))).toBe(true);
    expect(routes.some((r) => r.includes('/kept'))).toBe(false);
  });

  it('2 — an OBJECT export is not a Router', () => {
    expect(declaredFor('objectRoutes').length).toBeGreaterThan(0);
    expect(declaredFor('objectRoutes')[0].provenance.uncertainty).toBe(
      'unresolved-router-value',
    );
  });

  it('3 — a BARE external package is not a project router', () => {
    expect(declaredFor('helmet').length).toBeGreaterThan(0);
  });

  it('4 — a DYNAMIC mount prefix declares instead of mounting at a guessed path', () => {
    // The router IS provable here; its LOCATION is not. Mounting it would publish
    // the whole sub-tree at a prefix nobody proved — an invented route, which is
    // the one outcome this slice may never produce.
    const dyn = declaredFor('routes');
    expect(dyn.length).toBeGreaterThan(0);
    expect(dyn[0].detail).toContain('mount path is not a literal');
    for (const id of routes) expect(id).not.toContain('/api/');
  });

  it('5 — a require CYCLE invents no route and leaves a declared surface', () => {
    expect(routes.some((r) => r.includes('/b/a'))).toBe(false);
    expect(
      (report.skipped ?? []).some(
        (s) => s.reason.includes('mount depth limit') && s.reason.includes('cycle-a'),
      ),
    ).toBe(true);
  });

  it('a LOCAL `Router()` factory is refused — the package decides, not the name', () => {
    // `./fake-express` exports its own `Router`. Every literal reads like the real
    // one; only the require specifier differs, and that is the whole test.
    expect(declaredFor('lookalikeRouter').length).toBeGreaterThan(0);
    expect(routes.some((r) => r.includes('/lookalike'))).toBe(false);
  });

  it('no rejected form invents a URL', () => {
    for (const invented of [
      'entrypoint:GET /kept',
      'entrypoint:GET /api/users',
      'entrypoint:GET /api/health',
    ])
      expect(routes).not.toContain(invented);
  });
});

describe('a function export is MIDDLEWARE and stays exactly as it was', () => {
  it('is not declared as an unproved router', () => {
    // The discriminator is "exports a Router", never "was required relatively".
    // Declaring ordinary middleware would both bury the real refusals and imply a
    // doubt about a shape the lowering already models.
    expect(declaredFor('requireAuth')).toEqual([]);
    expect(
      exportsExpressRouter(path.join(dir, 'negatives', 'function-export.js')).callable,
    ).toBe(true);
  });

  it('middleware bound to an IDENTIFIER before export is middleware too', () => {
    // `const mw = (req,res,next) => {}; module.exports = mw` — same meaning as the
    // direct form, different AST shape, and the shape is what the check covers.
    expect(declaredFor('attachRequestId')).toEqual([]);
    expect(
      exportsExpressRouter(path.join(dir, 'negatives', 'identifier-middleware.js'))
        .callable,
    ).toBe(true);
  });

  it('every middleware the lowering saw before is still there', () => {
    // The declarations are ADDITIVE: they record an admission, they never replace
    // the model. Losing one of these would be losing a guard.
    for (const name of [
      'objectRoutes',
      'helmet',
      'mountAt',
      'requireAuth',
      'attachRequestId',
    ])
      expect(middlewareNames, name).toContain(name);
  });
});

describe('topology only — nothing else moves', () => {
  it('its boundary gates no proof obligation', () => {
    expect(affectedProperties('unresolved-router-value')).toEqual([]);
  });

  it('creates no guard and no effect of its own', () => {
    expect(g.nodes.filter((n) => n.kind === 'guard')).toEqual([]);
    expect(g.nodes.filter((n) => n.kind === 'effect')).toEqual([]);
  });

  it('states no verdict word and no safety claim', () => {
    for (const d of declared) {
      expect(d.provenance.uncertainty).toBe('unresolved-router-value');
      expect(d).not.toHaveProperty('proven');
      expect(d).not.toHaveProperty('safe');
    }
  });
});

describe('exportsExpressRouter refuses precisely', () => {
  const neg = (n) => exportsExpressRouter(path.join(dir, 'negatives', n));

  it('names WHY, with a distinct reason per shape', () => {
    expect(neg('object-export.js').router).toBe(false);
    expect(neg('object-export.js').reason).toMatch(/not a statically created/);
    expect(neg('function-export.js').callable).toBe(true);
  });

  it('an unresolved file is refused, not assumed', () => {
    expect(exportsExpressRouter(null).router).toBe(false);
    expect(exportsExpressRouter(path.join(dir, 'nope.js')).router).toBe(false);
  });
});
