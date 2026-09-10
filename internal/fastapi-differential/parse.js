// Stage 1: language syntax only. No routes, imports, policies or oracle reuse.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Parser, Language } from 'web-tree-sitter';
const require = createRequire(import.meta.url);
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export const grammarPath = require.resolve('tree-sitter-python/tree-sitter-python.wasm');
export const parserIdentity = {
  engine: 'web-tree-sitter@0.27.0',
  grammar: 'tree-sitter-python@0.25.0',
  grammarSha256: sha256(fs.readFileSync(grammarPath)),
};
let initialized;
async function language() {
  initialized ??= Parser.init().then(() => Language.load(grammarPath));
  return initialized;
}
export async function parseSource(
  source,
  file,
  { maxBytes = 2_000_000, maxNodes = 100_000 } = {},
) {
  const provenance = { file, sourceSha256: sha256(source), ...parserIdentity };
  const refusal = (reason) => ({
    schema: 'syntax/v1',
    state: 'UNKNOWN',
    provenance,
    reason,
    root: null,
  });
  if (Buffer.byteLength(source) > maxBytes) return refusal('source-budget');
  let parser, tree;
  try {
    const grammar = await language();
    parser = new Parser();
    parser.setLanguage(grammar);
    tree = parser.parse(source);
    if (!tree || tree.rootNode.hasError) return refusal('syntax-error');
    let count = 0;
    function copy(node) {
      if (++count > maxNodes) throw new Error('node-budget');
      if (node.isMissing || node.type === 'ERROR') throw new Error('syntax-error');
      const children = node.namedChildren,
        fields = {};
      for (let i = 0; i < children.length; i++) {
        const name = node.fieldNameForNamedChild(i);
        if (name) (fields[name] ??= []).push(i);
      }
      return {
        kind: node.type,
        value: [
          'identifier',
          'dotted_name',
          'relative_import',
          'string',
          'integer',
          'true',
          'false',
          'none',
        ].includes(node.type)
          ? node.text
          : null,
        fields,
        children: children.map(copy),
        provenance: {
          file,
          sourceSha256: provenance.sourceSha256,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          startByte: Buffer.byteLength(source.slice(0, node.startIndex)),
          endByte: Buffer.byteLength(source.slice(0, node.endIndex)),
        },
      };
    }
    return {
      schema: 'syntax/v1',
      state: 'PARSED',
      provenance,
      root: copy(tree.rootNode),
    };
  } catch (error) {
    return refusal(error.message);
  } finally {
    tree?.delete();
    parser?.delete();
  }
}
export async function parseProject(
  root,
  { maxFiles = 128, maxTotalBytes = 8_000_000, ...options } = {},
) {
  root = fs.realpathSync(root);
  const modules = [],
    unknowns = [];
  let total = 0;
  const inside = (p) => p === root || p.startsWith(root + path.sep);
  async function walk(dir) {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (['.git', 'node_modules', '.venv', 'venv', '__pycache__'].includes(entry.name))
        continue;
      const abs = path.join(dir, entry.name),
        file = path.relative(root, abs).replaceAll('\\', '/');
      if (entry.isSymbolicLink() || !inside(fs.realpathSync(abs))) {
        unknowns.push({
          kind: 'UnknownBoundary',
          state: 'UNKNOWN',
          reason: 'symlink-or-outside-root',
          file,
        });
        continue;
      }
      if (entry.isDirectory()) await walk(abs);
      else if (entry.name.endsWith('.py')) {
        const size = fs.statSync(abs).size;
        if (modules.length >= maxFiles || total + size > maxTotalBytes) {
          unknowns.push({
            kind: 'UnknownBoundary',
            state: 'UNKNOWN',
            reason: 'project-budget',
            file,
          });
          continue;
        }
        total += size;
        try {
          const source = new TextDecoder('utf-8', { fatal: true }).decode(
            fs.readFileSync(abs),
          );
          const parsed = await parseSource(source, file, options);
          modules.push(parsed);
          if (parsed.state === 'UNKNOWN')
            unknowns.push({
              kind: 'UnknownBoundary',
              state: 'UNKNOWN',
              reason: parsed.reason,
              provenance: parsed.provenance,
            });
        } catch (error) {
          unknowns.push({
            kind: 'UnknownBoundary',
            state: 'UNKNOWN',
            reason: 'unreadable-source',
            file,
            detail: error.message,
          });
        }
      }
    }
  }
  await walk(root);
  return { schema: 'syntax-project/v1', parser: parserIdentity, modules, unknowns };
}
