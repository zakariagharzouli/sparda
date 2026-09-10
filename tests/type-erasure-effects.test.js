import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFunction } from '../src/ubg/extract.js';
import { compileUBG } from '../src/ubg/compile.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

function effects(body) {
  const ast = parse(`function handler(req, res) { ${body} }`, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  return scanFunction(ast.program.body[0], {
    dbHandles: new Set(['Tag', 'Prisma', 'db']),
  }).effects;
}

function removeFixture(dir) {
  if (
    !path.basename(dir).startsWith('sparda-type-erasure-') ||
    path.dirname(dir) !== os.tmpdir()
  )
    throw Error('unexpected temporary path');
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('erased TypeScript syntax cannot supply a runtime database handle', () => {
  it.each([
    '(rows as Tag[]).map(x => x)',
    '(rows as unknown as { tag: Tag }[]).map(({tag}) => tag)',
    '(rows satisfies Tag[]).map(x => x)',
    '(rows as Prisma.TagGetPayload<{}>[])[op]()',
    '(rows as Tag[])`template`',
    '(rows as Tag[])!.map(x => x)',
    '(rows as Tag[]).map<Tag>(x => x)',
  ])('does not manufacture a write for %s', (source) => {
    expect(effects(`${source};`).filter((e) => e.effectType === 'db_write')).toEqual([]);
  });

  it.each([
    '(db as unknown as Tag).wipe()',
    '(db satisfies Tag)[op]()',
    '(db as Tag)`DELETE FROM note`',
    '(db as Tag)!.wipe()',
    '(condition ? db : fallback as Tag).wipe()',
  ])('retains a real runtime handle through %s', (source) => {
    expect(effects(`${source};`).some((e) => e.effectType === 'db_write')).toBe(true);
  });

  it('still descends into callbacks that perform a real database write', () => {
    const scan = effects('(rows as Tag[]).map(() => (db as Tag)[op]());');
    expect(scan.filter((e) => e.effectType === 'db_write')).toHaveLength(1);
  });

  it('removes only the type-created opaque effect in a real compilation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-type-erasure-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { express: '*' } }),
      );
      fs.writeFileSync(
        path.join(dir, 'app.ts'),
        `
        import express from 'express';
        import { PrismaClient, Tag } from '@prisma/client';
        const db = new PrismaClient();
        const app = express();
        app.get('/rows', async (req, res) => {
          const rows = await db.tag.findMany();
          res.json((rows as Tag[]).map(x => x));
        });
        app.post('/wipe', (req, res) => {
          (db as unknown as Tag)[req.body.op]();
          res.send('done');
        });
        export default app;
      `,
      );
      const graph = canonicalizeGraph(compileUBG(dir, { write: false }).graph);
      const { findings } = checkGraph(graph);
      const unguarded = findings
        .filter((f) => f.rule === 'UNGUARDED_MUTATION')
        .map((f) => f.entrypoint);
      expect(unguarded).not.toContain('entrypoint:GET /rows');
      expect(unguarded).toContain('entrypoint:POST /wipe');
      expect(
        graph.nodes.filter((n) => n.kind === 'effect' && n.meta.effectType === 'db_read'),
      ).toHaveLength(1);
      expect(
        graph.nodes.filter((n) => n.kind === 'effect' && n.meta.opaque),
      ).toHaveLength(1);
    } finally {
      removeFixture(dir);
    }
  });
});
