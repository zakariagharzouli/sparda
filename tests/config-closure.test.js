import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearModuleCache,
  configurationResolution,
  resolveRelImport,
} from '../src/ubg/extract.js';
import { compileUBG } from '../src/ubg/compile.js';

let root;
const put = (name, value) => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};
const config = (options) => ({ compilerOptions: options });
const resolve = (specifier = '@x/a') =>
  resolveRelImport(path.join(root, 'app/main.ts'), specifier);
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-config-'));
  clearModuleCache();
  put('app/main.ts', '');
});
afterEach(() => {
  clearModuleCache();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('bounded configuration dependency closure', () => {
  it('inherits extensionless local configs and anchors aliases at their declaration', () => {
    put('base.json', config({ baseUrl: '.', paths: { '@x/*': ['lib/*'] } }));
    put('app/tsconfig.json', { extends: '../base' });
    const target = put('lib/a.ts', 'export const a = 1');
    put('app/lib/a.ts', 'export const a = 2');
    expect(resolve()).toBe(target);
    expect(configurationResolution(root)).toEqual([
      expect.objectContaining({
        state: 'modelled',
        claim: 'baseUrl-and-paths-projection',
        fullConfigurationValidated: false,
        files: ['app/tsconfig.json', 'base.json'],
      }),
    ]);
  });
  it('anchors inherited paths without baseUrl at the parent', () => {
    put('cfg/base.json', config({ paths: { '@x/*': ['../lib/*'] } }));
    put('app/tsconfig.json', { extends: '../cfg/base.json' });
    expect(put('lib/a.ts', '')).toBe(resolve());
  });
  it('keeps the child directory when the parent has neither projected option', () => {
    put('base.json', {});
    put('app/tsconfig.json', { extends: '../base' });
    put('thing.ts', '');
    expect(put('app/thing.ts', '')).toBe(resolve('thing'));
  });
  it('replaces rather than merges paths, including an empty replacement', () => {
    put('base.json', config({ baseUrl: '.', paths: { '@x/*': ['lib/*'] } }));
    put('lib/a.ts', '');
    put('app/tsconfig.json', { extends: '../base', compilerOptions: { paths: {} } });
    expect(resolve()).toBeNull();
    expect(configurationResolution(root)[0].state).toBe('modelled');
  });
  it('admits a local projection over an unavailable package parent without certifying the parent', () => {
    put('app/tsconfig.json', {
      extends: 'uninstalled/config',
      compilerOptions: { baseUrl: '.', paths: { '@x/*': ['lib/*'] } },
    });
    expect(put('app/lib/a.ts', '')).toBe(resolve());
    expect(configurationResolution(root)[0]).toMatchObject({
      state: 'modelled',
      fullConfigurationValidated: false,
      unreadParents: [
        { extends: 'uninstalled/config', reason: 'local-projection-overrides-parent' },
      ],
    });
  });
  it.each([
    ['missing parent', { extends: './missing' }, 'config-unreadable'],
    ['package parent', { extends: 'uninstalled/config' }, 'config-unsupported-extends'],
    ['array parent', { extends: ['./a', './b'] }, 'config-unsupported-extends'],
    ['invalid JSON', '{bad', 'config-invalid-jsonc'],
    ['unterminated comment', '{} /* never ends', 'config-invalid-jsonc'],
    ['comment between numeric tokens', '{"x":1/*x*/2}', 'config-invalid-jsonc'],
    ['options array', { compilerOptions: [] }, 'config-invalid-shape'],
    ['baseUrl number', config({ baseUrl: 2 }), 'config-invalid-baseUrl'],
    ['paths array', config({ paths: [] }), 'config-invalid-paths'],
    ['target string', config({ paths: { '@x/*': 'lib/*' } }), 'config-invalid-paths'],
    ['multiple stars', config({ paths: { '@*/*': ['lib/*'] } }), 'config-invalid-paths'],
    ['empty targets', config({ paths: { '@x/*': [] } }), 'config-invalid-paths'],
  ])(
    'refuses %s and exposes unknown through the real resolver',
    (_label, value, reason) => {
      put('app/tsconfig.json', value);
      put('app/src/@x/a.ts', '');
      expect(resolve()).toBeNull();
      expect(configurationResolution(root)[0]).toMatchObject({
        state: 'unknown',
        reason,
      });
    },
  );
  it('refuses a cycle', () => {
    put('app/tsconfig.json', { extends: './other' });
    put('app/other.json', { extends: './tsconfig' });
    expect(resolve()).toBeNull();
    expect(configurationResolution(root)[0].reason).toBe('config-cycle');
  });
  it('refuses a baseUrl-only reanchor of inherited paths', () => {
    put('base.json', config({ baseUrl: '.', paths: { '@x/*': ['lib/*'] } }));
    put('app/tsconfig.json', { extends: '../base', compilerOptions: { baseUrl: '.' } });
    expect(resolve()).toBeNull();
    expect(configurationResolution(root)[0].reason).toBe(
      'config-inherited-paths-base-override',
    );
  });
  it('bounds configuration file count', () => {
    put('app/tsconfig.json', { extends: './c0' });
    for (let i = 0; i < 17; i++)
      put(`app/c${i}.json`, i === 16 ? {} : { extends: `./c${i + 1}` });
    expect(resolve()).toBeNull();
    expect(configurationResolution(root)[0].reason).toBe('config-file-budget');
  });
  it('bounds bytes before parsing', () => {
    put('app/tsconfig.json', ' '.repeat(4 * 1024 * 1024 + 1));
    expect(resolve()).toBeNull();
    expect(configurationResolution(root)[0].reason).toBe('config-byte-budget');
  });
  it('preserves comment markers and trailing-comma-like text inside JSON strings', () => {
    put(
      'app/tsconfig.json',
      '{/*comment*/"compilerOptions":{"paths":{"@x/*":["lib/*"],"literal":["keep,}literal"]},},}',
    );
    expect(put('app/lib/a.ts', '')).toBe(resolve());
    expect(put('app/keep,}literal.ts', '')).toBe(resolve('literal'));
  });
  it('prefers exact aliases over matching wildcards', () => {
    put(
      'app/tsconfig.json',
      config({ paths: { '@x/*': ['wild/*'], '@x/a': ['exact'] } }),
    );
    put('app/wild/a.ts', '');
    expect(put('app/exact.ts', '')).toBe(resolve());
  });
  it('prefers the longest matching wildcard prefix', () => {
    put(
      'app/tsconfig.json',
      config({ paths: { '@*': ['wild/*'], '@x/*': ['specific/*'] } }),
    );
    put('app/wild/x/a.ts', '');
    expect(put('app/specific/a.ts', '')).toBe(resolve());
  });
  it('invalidates graph identity when inherited configuration bytes change', () => {
    put('app/package.json', { dependencies: { express: '5.2.1' } });
    put(
      'app/app.js',
      "import express from 'express'; import {read} from '@x/a'; const app=express(); app.get('/a', (req,res)=>res.json(read())); app.listen(3000);",
    );
    put('base.json', config({ baseUrl: '.', paths: { '@x/*': ['lib/*'] } }));
    put('lib/a.ts', 'export function read() { return 1; }');
    put('app/tsconfig.json', { extends: '../base' });
    const first = compileUBG(path.join(root, 'app'), { write: false });
    expect(
      first.report.configurationResolution.some((c) => c.files.includes('../base.json')),
    ).toBe(true);
    fs.appendFileSync(path.join(root, 'base.json'), '\n// changed configuration bytes\n');
    const second = compileUBG(path.join(root, 'app'), { write: false });
    expect(second.graph.meta.sourceHash).not.toBe(first.graph.meta.sourceHash);
    expect(second.graph.nodes).toEqual(first.graph.nodes);
  });
});
