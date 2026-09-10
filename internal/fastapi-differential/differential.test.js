import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSource, parseProject } from './parse.js';
import { resolveProject } from './resolve.js';
import { registrationString } from './constants.js';
import { lowerSemanticProject } from './lower.js';
import { measureProject, compareExtractions } from './compare.js';
const here = path.dirname(fileURLToPath(import.meta.url)),
  repo = path.resolve(here, '../..');
const python = process.env.SPARDA_PYTHON ?? 'python';
let dir;
afterEach(() => {
  if (!dir) return;
  if (
    path.dirname(dir) !== fs.realpathSync(os.tmpdir()) ||
    !path.basename(dir).startsWith('sparda-python-')
  )
    throw Error('unsafe fixture cleanup');
  fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});
async function sample(body, other = {}, options = {}) {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sparda-python-'));
  for (const [name, contents] of Object.entries({ 'main.py': body, ...other })) {
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contents);
  }
  const syntax = await parseProject(dir, options),
    semantic = resolveProject(syntax, 'main.py', options);
  return { syntax, semantic, graph: lowerSemanticProject(semantic) };
}
const prelude =
  'from fastapi import FastAPI, Depends, Security, HTTPException\napp = FastAPI()\n';
describe('independent Python syntax and semantic boundaries', () => {
  it('stops constant resolution when its work budget is exhausted', async () => {
    const syntax = await parseSource(
      'PATH="/a"\n@app.get(PATH)\ndef a(): return 1\n',
      'main.py',
    );
    const decorator = syntax.root.children[1].children.find(
      (n) => n.kind === 'decorator',
    );
    const args = decorator.children[0].children.find((n) => n.kind === 'argument_list');
    expect(registrationString(syntax.root, args.children[0], () => true)?.value).toBe(
      '/a',
    );
    expect(registrationString(syntax.root, args.children[0], () => false)).toBeNull();
  });
  it('resolves a static dictionary route with its destructive effect and provenance', async () => {
    const r = await measureProject(
      path.join(repo, 'tests/fixtures/ubg-fastapi-ghost'),
      'main.py',
      python,
    );
    expect(r.semantic.routes).toHaveLength(2);
    const route = r.semantic.routes.find((x) => x.path === '/orders');
    expect(route).toMatchObject({
      method: 'delete',
      effects: [{ effectType: 'db_write', op: 'delete', table: 'orders' }],
    });
    expect(route.pathProvenance).toHaveLength(3);
    expect(
      r.graph.nodes.find((n) => n.id === 'entrypoint:DELETE /orders').meta.pathProvenance,
    ).toEqual(route.pathProvenance);
    expect(r.semantic.unknowns).toEqual([]);
    expect(r.comparison.zeroLoss).toBe(true);
  });
  it('resolves multiple literal-key reads and immutable strings', async () => {
    const { semantic } = await sample(
      prelude +
        'PATH="/health"\nROUTES={"a":"/a", "b":"/b"}\n@app.get(PATH)\ndef health(): return 1\n@app.get(ROUTES["a"])\ndef a(): return 1\n@app.post(path=ROUTES["b"])\ndef b(): return 1\n',
    );
    expect(semantic.routes.map((r) => r.path).sort()).toEqual(['/a', '/b', '/health']);
    expect(semantic.unknowns).toEqual([]);
  });
  it.each([
    ['mutation', 'ROUTES["a"]="/changed"\n', ''],
    ['alias escape', 'alias=ROUTES\n', ''],
    ['call escape', 'change(ROUTES)\n', ''],
    ['rebinding', 'ROUTES={"a":"/changed"}\n', ''],
    ['Unicode rebinding', 'ℝOUTES={"a":"/changed"}\n', ''],
    ['later mutation', '', 'ROUTES["a"]="/changed"\n'],
    ['reflective execution', 'exec("anything")\n', ''],
    ['wildcard imports', 'from elsewhere import *\n', ''],
  ])('keeps constant %s unknown', async (_label, before, after) => {
    const { semantic } = await sample(
      prelude +
        'ROUTES={"a":"/a"}\n' +
        before +
        '@app.get(ROUTES["a"])\ndef a(): return 1\n' +
        after,
    );
    expect(semantic.routes).toEqual([]);
    expect(semantic.unknowns.some((u) => u.reason === 'dynamic-route-path')).toBe(true);
  });
  it.each([
    ['missing key', '{"b":"/b"}', '"a"'],
    ['computed key', '{"a":"/a"}', 'name'],
    ['tuple key', '{"a":"/a"}', '"a", "b"'],
    ['computed value', '{"a":make_path()}', '"a"'],
    ['dictionary expansion', '{**other, "a":"/a"}', '"a"'],
    ['duplicate key', '{"a":"/a", "a":"/b"}', '"a"'],
  ])('declines %s in route constants', async (_label, dict, key) => {
    const { semantic } = await sample(
      prelude + `ROUTES=${dict}\n@app.get(ROUTES[${key}])\ndef a(): return 1\n`,
    );
    expect(semantic.routes).toEqual([]);
  });
  it('does not use a constant declared after registration', async () => {
    const { semantic } = await sample(
      prelude + '@app.get(PATH)\ndef a(): return 1\nPATH="/a"\n',
    );
    expect(semantic.routes).toEqual([]);
  });
  it('bounds constant dictionary size', async () => {
    const entries = Array.from({ length: 65 }, (_, i) => `"k${i}":"/p${i}"`).join(',');
    const { semantic } = await sample(
      prelude + `ROUTES={${entries}}\n@app.get(ROUTES["k0"])\ndef a(): return 1\n`,
    );
    expect(semantic.routes).toEqual([]);
  });
  it('rejects lost registration provenance during lowering', async () => {
    const r = await measureProject(
      path.join(repo, 'tests/fixtures/ubg-fastapi-ghost'),
      'main.py',
      python,
    );
    delete r.graph.nodes.find((n) => n.id === 'entrypoint:DELETE /orders').meta
      .pathProvenance;
    expect(compareExtractions(r.oracle, r.semantic, r.graph).zeroLoss).toBe(false);
  });
  it('declares application dependency overrides', async () => {
    const { semantic } = await sample(
      prelude +
        'def gate(): return 1\ndef replacement(): return 2\napp.dependency_overrides[gate] = replacement\n@app.get("/")\ndef x(user=Depends(gate)): return user\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'dependency-overrides')).toBe(true);
  });
  it('declares dependency cache and lifetime options outside the admitted slice', async () => {
    const { semantic } = await sample(
      prelude +
        'def gate(): return 1\n@app.get("/")\ndef x(user=Depends(gate, use_cache=False)): return user\n',
    );
    expect(
      semantic.unknowns.some((u) => u.reason === 'dependency-lifecycle-options'),
    ).toBe(true);
  });
  it('declares yield teardown semantics instead of certifying them', async () => {
    const { semantic } = await sample(
      prelude +
        'def gate():\n    yield 1\n@app.get("/")\ndef x(user=Depends(gate)): return user\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'yield-lifetime')).toBe(true);
  });
  it('preserves app, router and mount dependency scopes independently', async () => {
    const { semantic } = await sample(
      'from fastapi import FastAPI, APIRouter, Depends\ndef a(): return 1\ndef b(): return 2\ndef c(): return 3\napp=FastAPI(dependencies=[Depends(a)])\nr=APIRouter(dependencies=[Depends(b)])\n@r.get("/x")\ndef x(): return 1\napp.include_router(r, dependencies=[Depends(c)])\n',
    );
    expect(semantic.routes[0].dependencies.map((d) => d.target)).toEqual(['a', 'c', 'b']);
  });
  it('resolves dependencies inside Annotated parameters', async () => {
    const { semantic } = await sample(
      prelude +
        'from typing import Annotated\ndef gate(): return 1\n@app.get("/")\ndef x(user: Annotated[str, Security(gate, scopes=["read"])]): return user\n',
    );
    expect(semantic.routes[0].dependencies[0]).toMatchObject({
      dependencyKind: 'Security',
      scopes: ['read'],
      state: 'RESOLVED',
    });
  });
  it('bounds semantic work independently of recursion depth', async () => {
    const { semantic } = await sample(
      prelude + '@app.get("/")\ndef x(): return 1\n',
      {},
      { maxWork: 0 },
    );
    expect(semantic.unknowns.some((u) => u.reason === 'semantic-work-budget')).toBe(true);
  });
  it('records UTF-8 byte provenance for Unicode source', async () => {
    const s = 'message = "é😀"\nvalue = 3\n',
      p = await parseSource(s, 'unicode.py');
    expect(p.state).toBe('PARSED');
    expect(p.root.children[1].provenance.startByte).toBe(
      Buffer.byteLength(s.slice(0, s.indexOf('value'))),
    );
    expect(p.provenance.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    ['syntax error', 'def broken(:\n', {}, 'syntax-error'],
    ['source budget', 'value = 3', { maxBytes: 2 }, 'source-budget'],
    ['node budget', 'value = 3', { maxNodes: 1 }, 'node-budget'],
  ])('refuses %s in the syntax contract', async (_n, source, options, reason) => {
    expect(await parseSource(source, 'main.py', options)).toMatchObject({
      state: 'UNKNOWN',
      reason,
      root: null,
    });
  });
  it('declares a file budget instead of returning a complete empty project', async () => {
    const { semantic } = await sample(prelude, {}, { maxFiles: 0 });
    expect(semantic.unknowns.some((u) => u.reason === 'project-budget')).toBe(true);
  });
  it('declares the total byte budget', async () => {
    const { semantic } = await sample(prelude, {}, { maxTotalBytes: 1 });
    expect(semantic.state).toBe('UNKNOWN');
  });
  it('declares a dynamic route instead of losing it silently', async () => {
    const { semantic, graph } = await sample(
      prelude + '@app.get(PATH)\ndef x(): return 1\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'dynamic-route-path')).toBe(true);
    expect(graph.meta.productionEligible).toBe(false);
  });
  it('declines a dynamic mount prefix', async () => {
    const { semantic } = await sample(
      prelude +
        'from fastapi import APIRouter\nr = APIRouter()\napp.include_router(r, prefix=PREFIX)\n',
    );
    expect(semantic.state).toBe('UNKNOWN');
  });
  it('declines a dynamic router prefix', async () => {
    const { semantic } = await sample(
      prelude +
        'from fastapi import APIRouter\nr = APIRouter(prefix=PREFIX)\napp.include_router(r)\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'dynamic-router-prefix')).toBe(
      true,
    );
  });
  it('declares repeated router mounts that change prefixes through a cycle', async () => {
    const { semantic } = await sample(
      prelude +
        'from fastapi import APIRouter\nr = APIRouter()\nr.include_router(r, prefix="/again")\napp.include_router(r)\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'router-cycle-or-depth')).toBe(
      true,
    );
  });
  it.each(['Depends', 'Security'])(
    'resolves imported %s aliases with original symbol provenance',
    async (kind) => {
      const { semantic } = await sample(
        `from fastapi import FastAPI, ${kind} as dependency\nfrom auth import verified as gate\napp=FastAPI()\n@app.get("/")\ndef x(user=dependency(gate)): return user\n`,
        { 'auth.py': 'def verified(): return 1\n' },
      );
      expect(semantic.routes[0].dependencies[0]).toMatchObject({
        state: 'RESOLVED',
        dependencyKind: kind,
        targetProvenance: { file: 'auth.py', line: 1 },
        authorizationProven: null,
      });
    },
  );
  it('does not treat a foreign Depends spelling as a FastAPI dependency', async () => {
    const { semantic } = await sample(
      'from fastapi import FastAPI\nfrom fake import Depends\napp=FastAPI()\n@app.get("/")\ndef x(user=Depends(gate)): return user\n',
    );
    expect(semantic.routes[0].dependencies).toEqual([]);
    expect(semantic.state).toBe('UNKNOWN');
  });
  it('keeps an unresolved dependency UNKNOWN', async () => {
    const { semantic } = await sample(
      prelude + '@app.get("/")\ndef x(user=Depends(missing)): return user\n',
    );
    expect(semantic.routes[0].dependencies[0].state).toBe('UNKNOWN');
    expect(semantic.unknowns.some((u) => u.reason === 'unresolved-dependency')).toBe(
      true,
    );
  });
  it('retains Security scopes without inventing a role proof', async () => {
    const { semantic } = await sample(
      prelude +
        'def gate(): return 1\n@app.get("/")\ndef x(user=Security(gate, scopes=["read"])): return user\n',
    );
    expect(semantic.routes[0].dependencies[0]).toMatchObject({
      scopes: ['read'],
      authorizationProven: null,
    });
  });
  it('declines dynamic Security scopes', async () => {
    const { semantic } = await sample(
      prelude +
        'def gate(): return 1\n@app.get("/")\ndef x(user=Security(gate, scopes=SCOPES)): return user\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'dynamic-security-scopes')).toBe(
      true,
    );
  });
  it('traverses nested dependencies', async () => {
    const { semantic } = await sample(
      prelude +
        'def token(): return 1\ndef gate(t=Depends(token)): return t\n@app.get("/")\ndef x(user=Depends(gate)): return user\n',
    );
    expect(semantic.routes[0].dependencies.map((d) => d.target)).toEqual([
      'gate',
      'token',
    ]);
  });
  it('bounds cyclic dependencies', async () => {
    const { semantic } = await sample(
      prelude +
        'def gate(t=Depends(gate)): return t\n@app.get("/")\ndef x(user=Depends(gate)): return user\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'dependency-cycle-or-depth')).toBe(
      true,
    );
  });
  it('bounds recursive calls', async () => {
    const { semantic } = await sample(
      prelude + 'def loop(): return loop()\n@app.get("/")\ndef x(): return loop()\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'call-cycle-or-depth')).toBe(true);
  });
  it('declares an unresolved call and attaches the boundary to the UBG', async () => {
    const { semantic, graph } = await sample(
      prelude + '@app.get("/")\ndef x(): return magic()\n',
    );
    expect(semantic.unknowns.some((u) => u.reason === 'unresolved-call')).toBe(true);
    expect(
      graph.nodes.some(
        (n) => n.meta.boundary?.reason === 'unresolved-call' && n.meta.opaque,
      ),
    ).toBe(true);
  });
  it.each(['select', 'insert', 'update', 'delete'])(
    'resolves imported SQLAlchemy %s with an explicit table',
    async (op) => {
      const { semantic, graph } = await sample(
        prelude +
          `from sqlalchemy import ${op} as operation\nfrom models import User\n@app.post("/")\ndef x(): return db.execute(operation(User))\n`,
        { 'models.py': 'class User:\n    __tablename__="accounts"\n' },
      );
      expect(semantic.routes[0].effects[0]).toMatchObject({
        op,
        table: 'accounts',
        provenance: { file: 'main.py' },
      });
      expect(
        graph.nodes.find((n) => n.kind === 'effect').meta.semanticFact.provenance
          .sourceSha256,
      ).toMatch(/^[a-f0-9]{64}$/);
    },
  );
  it('does not invent a table from the model class name', async () => {
    const { semantic } = await sample(
      prelude +
        'from sqlalchemy import select\nclass User: pass\n@app.get("/")\ndef x(): return db.execute(select(User))\n',
    );
    expect(semantic.routes[0].effects[0]).toMatchObject({
      table: null,
      state: 'UNKNOWN',
    });
  });
  it('does not treat a foreign select function as SQLAlchemy', async () => {
    const { semantic } = await sample(
      prelude +
        'def select(x): return x\n@app.get("/")\ndef x(): return db.execute(select(User))\n',
    );
    expect(semantic.routes[0].effects[0]).toMatchObject({
      op: 'unknown',
      table: null,
      state: 'UNKNOWN',
    });
  });
  it('never marks dependencies or the experimental graph as authorization proven', async () => {
    const { graph } = await sample(
      prelude +
        'def gate(): raise HTTPException(status_code=403)\n@app.get("/")\ndef x(user=Depends(gate)): return user\n',
    );
    expect(graph.meta.authorizationProven).toBeNull();
    expect(graph.nodes.some((n) => n.meta.verified === true)).toBe(false);
  });
});
describe('differential conservation is executable and fail closed', () => {
  it.each(['table', 'path', 'effect-edge', 'line', 'source-file', 'source-hash'])(
    'rejects a %s change during UBG lowering despite equal counts',
    async (which) => {
      const r = await measureProject(
        path.join(
          repo,
          which === 'path'
            ? 'tests/fixtures/fastapi-basic'
            : 'tests/fixtures/ubg-fastapi',
        ),
        'main.py',
        python,
      );
      const effect = r.graph.nodes.find((n) => n.kind === 'effect' && n.meta.table);
      if (which === 'table') effect.meta.table = 'wrong';
      if (which === 'line') effect.loc.line = 999;
      if (which === 'source-file') effect.loc.file = 'wrong.py';
      if (which === 'source-hash') effect.meta.provenance.sourceSha256 = 'wrong';
      if (which === 'path')
        r.graph.nodes.find((n) => n.kind === 'entrypoint').meta.path = '/wrong';
      if (which === 'effect-edge')
        r.graph.edges = r.graph.edges.filter((e) => e.to !== effect.id);
      expect(compareExtractions(r.oracle, r.semantic, r.graph).zeroLoss).toBe(false);
    },
  );
  it.each(['fastapi-basic', 'fastapi-package', 'ubg-fastapi'])(
    'retains routes and effects on %s',
    async (name) => {
      const r = await measureProject(
        path.join(repo, 'tests/fixtures', name),
        name === 'fastapi-package' ? 'app/main.py' : 'main.py',
        python,
      );
      expect(r.comparison.zeroLoss).toBe(true);
    },
  );
  it('reports unknown dynamic registration instead of a green zero', async () => {
    const r = await measureProject(
      path.join(repo, 'tests/fixtures/ubg-fastapi-dynamic'),
      'main.py',
      python,
    );
    expect(r.comparison.zeroLoss).toBeNull();
  });
  it('preserves unknown tables after correcting the legacy class-name heuristic', async () => {
    const r = await measureProject(
      path.join(repo, 'tests/fixtures/ubg-fastapi-deep'),
      'main.py',
      python,
    );
    expect(r.comparison.zeroLoss).toBeNull();
    expect(r.comparison.missingEffects).toEqual([]);
    expect(
      r.semantic.routes
        .flatMap((x) => x.effects)
        .every((e) => e.provenance.file.startsWith('services/')),
    ).toBe(true);
  });
  it('keeps an unavailable oracle unmeasured on a real execution path', async () => {
    const r = await measureProject(
      path.join(repo, 'tests/fixtures/fastapi-basic'),
      'main.py',
      'nonexistent-sparda-python',
    );
    expect(r.comparison.zeroLoss).toBeNull();
    expect(r.oracleError).toBeTruthy();
  });
  it('rejects missing input in the contract', () =>
    expect(compareExtractions(null, null, null).zeroLoss).toBeNull());
  it.each(['route', 'effect', 'duplicate', 'graph-effect', 'graph-route'])(
    'detects %s loss, including multiplicity and lowering loss',
    async (which) => {
      const r = await measureProject(
        path.join(repo, 'tests/fixtures/ubg-fastapi'),
        'main.py',
        python,
      );
      if (which === 'route') r.semantic.routes.pop();
      if (which === 'effect')
        r.semantic.routes.find((x) => x.effects.length).effects.pop();
      if (which === 'duplicate') {
        const s = r.oracle.routes
          .flatMap((x) => x.chain)
          .find((x) => x.scan.effects.length);
        s.scan.effects.push(s.scan.effects[0]);
      }
      if (which === 'graph-effect')
        r.graph.nodes = r.graph.nodes.filter((n) => n.kind !== 'effect');
      if (which === 'graph-route')
        r.graph.nodes = r.graph.nodes.filter((n) => n.kind !== 'entrypoint');
      expect(compareExtractions(r.oracle, r.semantic, r.graph).zeroLoss).toBe(false);
    },
  );
  it('preserves additional Security and Annotated evidence without claiming parity', async () => {
    const r = await measureProject(
      path.join(here, 'fixtures/contract'),
      'main.py',
      python,
    );
    expect(r.comparison.missingRoutes).toEqual([]);
    expect(r.comparison.missingEffects).toEqual([]);
    expect(
      r.semantic.routes.find((x) => x.path === '/security').dependencies[0]
        .dependencyKind,
    ).toBe('Security');
    expect(
      r.semantic.routes.find((x) => x.path === '/annotated').dependencies[0]
        .dependencyKind,
    ).toBe('Depends');
    expect(r.comparison.promotionEligible).toBe(false);
  });
  it('produces identical semantics and UBG across fresh parses', async () => {
    const root = path.join(here, 'fixtures/contract');
    const a = await measureProject(root, 'main.py', python),
      b = await measureProject(root, 'main.py', python);
    expect(a.semantic).toEqual(b.semantic);
    expect(a.graph).toEqual(b.graph);
  });
});
