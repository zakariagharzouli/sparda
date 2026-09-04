// release-sync.test.js — the version + identity of every registry manifest must agree with
// package.json. A release bumps package.json, server.json (twice: top-level + packages[0]), and
// glama.json; if any is forgotten the npm package and the MCP-registry manifest disagree, which is
// exactly how the official MCP entry once rotted to a stale version. This test makes that drift
// impossible to ship: it fails `npm test` (the release gate), so it never relies on remembering.
//
// NOT synced here on purpose: .claude-plugin/marketplace.json `metadata.version` is the plugin
// marketplace's own schema version, not the npm package version — it moves independently.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const pkg = read('package.json');
const server = read('server.json');
const glama = read('glama.json');
const vscode = read('extensions/vscode/package.json');

describe('release sync: all registry manifests agree with package.json', () => {
  it('every version-bearing field equals the package version', () => {
    const version = pkg.version;
    const fields = {
      'package.json version': pkg.version,
      'server.json version': server.version,
      'server.json packages[0].version': server.packages[0].version,
      'glama.json version': glama.version,
      'extensions/vscode/package.json version': vscode.version,
    };
    const drifted = Object.entries(fields).filter(([, v]) => v !== version);
    expect(
      drifted,
      `these version fields drifted from package.json (${version}) — bump them together ` +
        `before publish: ${drifted.map(([k, v]) => `${k}=${v}`).join(', ')}`,
    ).toEqual([]);
  });

  it('the MCP server identity matches the npm package identity', () => {
    expect(server.name, 'server.json name must equal package.json mcpName').toBe(
      pkg.mcpName,
    );
    expect(
      server.packages[0].identifier,
      'server.json packages[0].identifier must equal the npm package name',
    ).toBe(pkg.name);
    expect(server.packages[0].registryType).toBe('npm');
  });

  it('the version is a clean semver (no pre-release cruft slips into a manifest)', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('adversarial identity contract: platforms maintain distinct namespaces', () => {
  it('strictly preserves the VS Code Marketplace publisher as zyx77550', () => {
    expect(
      vscode.publisher,
      'extensions/vscode/package.json publisher must strictly remain zyx77550 (immutable marketplace publisher)',
    ).toBe('zyx77550');
  });

  it('strictly points public GitHub repository URLs to zakariagharzouli/sparda', () => {
    expect(pkg.repository.url).toBe('git+https://github.com/zakariagharzouli/sparda.git');
    expect(pkg.homepage).toBe('https://github.com/zakariagharzouli/sparda#readme');
    expect(pkg.bugs.url).toBe('https://github.com/zakariagharzouli/sparda/issues');
    expect(server.repository.url).toBe('https://github.com/zakariagharzouli/sparda');
  });

  it('preserves MCP server namespace and Glama maintainer without blind renaming', () => {
    expect(pkg.mcpName).toBe('io.github.zyx77550/sparda-mcp');
    expect(server.name).toBe('io.github.zyx77550/sparda-mcp');
    expect(glama.maintainers).toContain('zyx77550');
  });

  it('refuses accidental blind unification of distinct platform identities', () => {
    // GitHub public owner is zakariagharzouli
    // VS Code publisher is zyx77550
    // MCP namespace contains zyx77550
    // Glama maintainer is zyx77550
    expect(pkg.repository.url).not.toContain('zyx77550/sparda.git');
    expect(vscode.publisher).not.toBe('zakariagharzouli');
  });
});
