import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { extractFastAPI } from '../src/ubg/fastapi.js';
import { compileUBG } from '../src/ubg/compile.js';
import { measureProject } from '../internal/fastapi-differential/compare.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.SPARDA_PYTHON ?? 'python';
const prelude = 'from fastapi import FastAPI\napp=FastAPI()\n';
let temporary;
afterEach(() => {
  if (!temporary) return;
  if (
    path.dirname(temporary) !== fs.realpathSync(os.tmpdir()) ||
    !path.basename(temporary).startsWith('sparda-reference-')
  )
    throw Error('unsafe cleanup');
  fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
});
function project(source, other = {}) {
  temporary = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'sparda-reference-'),
  );
  for (const [file, content] of Object.entries({
    'main.py': source,
    'requirements.txt': 'fastapi\n',
    ...other,
  })) {
    const destination = path.join(temporary, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  return temporary;
}
const effects = (oracle) =>
  oracle.routes.flatMap((r) => r.chain.flatMap((s) => s.scan.effects));

describe('independent CPython reference: route registration', () => {
  it('recovers the unchanged ghost route and its DELETE effect', async () => {
    const result = await measureProject(
      path.join(repo, 'tests/fixtures/ubg-fastapi-ghost'),
      'main.py',
      python,
    );
    expect(result.oracle.routes.map((r) => r.method + ' ' + r.path)).toEqual([
      'get /health',
      'delete /orders',
    ]);
    expect(effects(result.oracle)).toEqual([
      expect.objectContaining({ effectType: 'db_write', op: 'delete', table: 'orders' }),
    ]);
    expect(result.comparison.zeroLoss).toBe(true);
  });
  it('supports strings, dictionary reads and keyword path arguments independently', () => {
    const root = project(
      prelude +
        'PATH="/a"\nROUTES={"b":"/b"}\n@app.get(PATH)\ndef a(): return 1\n@app.get(path=ROUTES["b"])\ndef b(): return 1\n',
    );
    expect(extractFastAPI(root, 'main.py', python).routes.map((r) => r.path)).toEqual([
      '/a',
      '/b',
    ]);
  });
  it.each([
    ['mutation', 'ROUTES["a"]="/changed"\n'],
    ['rebinding', 'ROUTES={"a":"/changed"}\n'],
    ['Unicode rebinding', 'ℝOUTES={"a":"/changed"}\n'],
    ['alias escape', 'copy=ROUTES\n'],
    ['call escape', 'change(ROUTES)\n'],
    ['reflection', 'exec("anything")\n'],
    ['wildcard', 'from somewhere import *\n'],
  ])('declares %s rather than claiming a resolved route', (_name, extra) => {
    const root = project(
      prelude +
        'ROUTES={"a":"/a"}\n' +
        extra +
        '@app.delete(ROUTES["a"])\ndef a(): return 1\n',
    );
    const result = extractFastAPI(root, 'main.py', python);
    expect(result.routes).toEqual([]);
    expect(result.unknownHandlers).toHaveLength(1);
    expect(result.skipped.some((s) => s.risk === 'high')).toBe(true);
  });
  it.each([
    ['tuple key', '{"a":"/a"}', '"a", "b"'],
    ['missing key', '{"b":"/b"}', '"a"'],
    ['computed key', '{"a":"/a"}', 'key'],
    ['computed value', '{"a":factory()}', '"a"'],
    ['duplicate key', '{"a":"/a", "a":"/b"}', '"a"'],
    ['expansion', '{**values}', '"a"'],
  ])('does not guess %s', (_label, dictionary, key) => {
    const root = project(
      prelude + `ROUTES=${dictionary}\n@app.get(ROUTES[${key}])\ndef a(): return 1\n`,
    );
    expect(extractFastAPI(root, 'main.py', python).unknownHandlers).toHaveLength(1);
  });
  it('does not resolve a late definition', () => {
    const root = project(prelude + '@app.get(PATH)\ndef a(): return 1\nPATH="/a"\n');
    expect(extractFastAPI(root, 'main.py', python).routes).toEqual([]);
  });
  it('bounds dictionary size', () => {
    const entries = Array.from({ length: 65 }, (_, i) => `"k${i}":"/p${i}"`).join(',');
    const root = project(
      prelude + `ROUTES={${entries}}\n@app.get(ROUTES["k0"])\ndef a(): return 1\n`,
    );
    expect(extractFastAPI(root, 'main.py', python).routes).toEqual([]);
  });
  it('bounds the independent constant traversal', () => {
    const root = project(
      prelude +
        'PATH="/a"\n' +
        'ignored=1\n'.repeat(17000) +
        '@app.get(PATH)\ndef a(): return 1\n',
    );
    expect(extractFastAPI(root, 'main.py', python).unknownHandlers).toHaveLength(1);
  });
});

describe('independent CPython reference: SQLAlchemy targets', () => {
  it.each(['Record=other', 'Record.__tablename__="changed"'])(
    'declines rebinding inside an imported model: %s',
    async (rebinding) => {
      const root = project(
        prelude +
          'from sqlalchemy import select\nfrom models import Record as User\n@app.get("/")\ndef a(): return db.execute(select(User))\n',
        {
          'models.py': 'class Record:\n    __tablename__="accounts"\n' + rebinding + '\n',
        },
      );
      const result = await measureProject(root, 'main.py', python);
      expect(effects(result.oracle)[0].table).toBeNull();
      expect(result.semantic.routes[0].effects[0].table).toBeNull();
      expect(result.comparison.zeroLoss).toBeNull();
    },
  );
  it('keeps all deep effects and declines the undeclared physical table', async () => {
    const root = path.join(repo, 'tests/fixtures/ubg-fastapi-deep');
    const result = await measureProject(root, 'main.py', python);
    const opaque = effects(result.oracle).filter((e) => e.opaque);
    expect(opaque).toHaveLength(3);
    expect(opaque.every((e) => e.table === null)).toBe(true);
    expect(result.comparison.missingEffects).toEqual([]);
    expect(result.comparison.zeroLoss).toBeNull();
    expect(result.comparison.authorizationParity).toBeNull();
    const compiled = compileUBG(root, { write: false });
    expect(
      [...compiled.graph.nodes.values()].some(
        (n) => n.kind === 'state' && n.meta.table === 'item',
      ),
    ).toBe(false);
    expect(
      [...compiled.graph.nodes.values()].some(
        (n) => n.kind === 'effect' && n.meta.opaque && n.meta.op === 'insert',
      ),
    ).toBe(true);
  });
  it.each(['select', 'insert', 'update', 'delete'])(
    'resolves imported and aliased %s with a declared table',
    async (operation) => {
      const root = project(
        prelude +
          `from sqlalchemy import ${operation} as operation\nfrom models import Record as User\n@app.post("/")\ndef a(): return db.execute(operation(User))\n`,
        { 'models.py': 'class Record:\n    __tablename__="accounts"\n' },
      );
      const result = await measureProject(root, 'main.py', python);
      expect(effects(result.oracle)[0]).toMatchObject({
        op: operation,
        table: 'accounts',
        opaque: false,
      });
      expect(result.oracle.scannedFiles).toContain('models.py');
      expect(result.comparison.zeroLoss).toBe(true);
    },
  );
  it('supports a SQLAlchemy module alias', async () => {
    const root = project(
      prelude +
        'import sqlalchemy as sa\nfrom models import User\n@app.get("/")\ndef a(): return db.execute(sa.select(User))\n',
      { 'models.py': 'class User:\n    __tablename__="accounts"\n' },
    );
    expect((await measureProject(root, 'main.py', python)).comparison.zeroLoss).toBe(
      true,
    );
  });
  it.each([
    ['model parameter', 'User', ''],
    ['model local', '', '    User=other\n'],
    ['builder parameter', 'select', ''],
    ['builder local', '', '    select=other\n'],
  ])('preserves unknown for a shadowed %s', async (_label, parameters, local) => {
    const root = project(
      prelude +
        `from sqlalchemy import select\nclass User:\n    __tablename__="accounts"\n@app.get("/")\ndef a(${parameters}):\n${local}    return db.execute(select(User))\n`,
    );
    const result = await measureProject(root, 'main.py', python);
    expect(effects(result.oracle)[0].table).toBeNull();
    expect(result.semantic.routes[0].effects[0].table).toBeNull();
    expect(result.comparison.zeroLoss).toBeNull();
  });
  it('does not promote an unrelated select function to SQLAlchemy', () => {
    const root = project(
      prelude +
        'from foreign import select\nclass User:\n    __tablename__="accounts"\n@app.get("/")\ndef a(): return db.execute(select(User))\n',
      { 'foreign.py': 'def select(x): return x\n' },
    );
    expect(effects(extractFastAPI(root, 'main.py', python))[0]).toMatchObject({
      op: 'unknown',
      table: null,
    });
  });
  it('keeps a module-level model rebinding unknown in both implementations', async () => {
    const root = project(
      prelude +
        'from sqlalchemy import select\nclass User:\n    __tablename__="accounts"\nUser=other\n@app.get("/")\ndef a(): return db.execute(select(User))\n',
    );
    const result = await measureProject(root, 'main.py', python);
    expect(effects(result.oracle)[0].table).toBeNull();
    expect(result.semantic.routes[0].effects[0].table).toBeNull();
  });
});
