// ubg/nest-static-path.js — the V1 grammar for a Nest route decorator's path.
//
// `@Get(`${ROOT}/things`)` is a route the framework serves at a URL that is fully
// determined at build time. The lowering read only `StringLiteral`, so the path
// was unreadable, the route was placed at the controller prefix, and the doubt
// was declared. Measured on the Lab probe against Core 5f490a8: two handlers, two
// entrypoints at `/`, two `dynamic path` declarations.
//
// This module makes THAT path precise and nothing else. It cannot credit a guard,
// an owner, a validation or a verdict — it answers one question: what URL is this
// handler served at, if the answer is statically forced?
//
// NOT a JavaScript evaluator. The grammar is closed and tiny, and everything
// outside it is `null` — which the caller turns back into the SAME declared
// boundary the route already had. An unresolved expression must never become a
// made-up URL, so `null` here is the safe answer, not a failure.
//
// GRAMMAR (exhaustive):
//   1. a string literal
//   2. an array of accepted expressions
//   3. a template literal whose every interpolation is an accepted single string
//   4. a program-scope `const` whose initializer is accepted
//   5. a named import of an exported program-scope `const` from a module the Core's
//      EXISTING resolver already opened (`mod.imports`) — no second resolver
//
// Everything else is unknown, deliberately: `let`/`var`, calls, member reads,
// `process.env`, external packages, unresolved aliases, cycles, depth.
import { parseModule } from './extract.js';

// A binding is only usable if the language itself forbids it changing. `let`/`var`
// can be reassigned between module evaluation and the decorator running, so their
// value at parse time is not the value Nest sees.
const CONST_KIND = 'const';

// Bounded like every other walk in this compiler. A chain this deep is not a
// route prefix anyone wrote; it is a sign the grammar is being pushed.
const MAX_BINDING_DEPTH = 8;

// Program-scope `const NAME = <init>` in a module, or null. Program scope only:
// a binding inside a function or block is not the one a decorator at class level
// reads, and pretending otherwise would resolve the wrong value.
function programConstInit(mod, name) {
  for (const node of mod?.ast?.program?.body ?? []) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type !== 'VariableDeclaration' || decl.kind !== CONST_KIND) continue;
    for (const d of decl.declarations)
      if (d.id?.type === 'Identifier' && d.id.name === name && d.init) return d.init;
  }
  return null;
}

// Is this name EXPORTED as a program-scope const? A named import may only read an
// exported binding; resolving a module-private one would report a value the
// importing module cannot actually see.
function exportedConstInit(mod, name) {
  for (const node of mod?.ast?.program?.body ?? []) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue;
    const decl = node.declaration;
    if (decl.type !== 'VariableDeclaration' || decl.kind !== CONST_KIND) continue;
    for (const d of decl.declarations)
      if (d.id?.type === 'Identifier' && d.id.name === name && d.init) return d.init;
  }
  return null;
}

// The local alias a named import binds, mapped back to the name it imports:
// `import { API as ROOT } from './c'` → ROOT reads `API`. Without this an aliased
// import resolves the wrong export, or none.
function importedBindingOf(mod, local) {
  for (const node of mod?.ast?.program?.body ?? []) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers ?? []) {
      if (spec.type !== 'ImportSpecifier' || spec.local?.name !== local) continue;
      const imported = spec.imported;
      // `import { 'a-b' as x }` — a string-keyed import is not a plain name
      if (imported?.type !== 'Identifier') return null;
      return { name: imported.name, source: node.source.value };
    }
  }
  return null;
}

// → an array of strings, or null. `null` is "not forced by this grammar", which
// the caller must preserve as the existing declared boundary.
//
// `seen` is the cycle guard, keyed on (module file, binding name): the Lab's
// negative fixture is two constants importing each other, and without this the
// walk would recurse until the stack gave out rather than declaring the limit.
export function staticPathsOf(node, mod, depth = 0, seen = new Set()) {
  if (!node || depth > MAX_BINDING_DEPTH) return null;

  // 1 — a string literal
  if (node.type === 'StringLiteral') return [node.value];

  // 2 — an array: EVERY element must resolve. One unreadable element is one lost
  // route, so a partial answer would silently drop a URL the app serves.
  if (node.type === 'ArrayExpression') {
    const out = [];
    for (const el of node.elements) {
      if (!el) return null; // a hole (`['a', , 'b']`) is not a path
      const resolved = staticPathsOf(el, mod, depth + 1, seen);
      if (!resolved) return null;
      out.push(...resolved);
    }
    return out;
  }

  // 3 — a template literal. Every interpolation must resolve to exactly ONE
  // string: an interpolation that could be several paths does not concatenate
  // into a single URL, and picking one would invent the others away.
  if (node.type === 'TemplateLiteral') {
    let out = '';
    for (let i = 0; i < node.quasis.length; i++) {
      // `cooked` is null for an invalid escape; `raw` would be a different string
      const cooked = node.quasis[i].value.cooked;
      if (cooked == null) return null;
      out += cooked;
      const expr = node.expressions[i];
      if (!expr) continue;
      const resolved = staticPathsOf(expr, mod, depth + 1, seen);
      if (!resolved || resolved.length !== 1) return null;
      out += resolved[0];
    }
    return [out];
  }

  // 4 & 5 — an identifier: a program-scope const here, or a named import of one
  if (node.type === 'Identifier') {
    const key = `${mod?._file ?? '<unknown>'}#${node.name}`;
    if (seen.has(key)) return null; // cycle — declared, never unrolled
    // COPIED per branch, never shared: sibling interpolations that read the same
    // binding (`${SEG}${SEG}`) are a repeat, not a loop, and poisoning the second
    // one would lose a URL that is fully determined. Deleting the `seen.has` line
    // above is unobservable on its own — MAX_BINDING_DEPTH still stops a cycle and
    // still answers null — so the killing mutant targets this sharing instead.
    const nextSeen = new Set(seen).add(key);

    const local = programConstInit(mod, node.name);
    if (local) return staticPathsOf(local, mod, depth + 1, nextSeen);

    const imported = importedBindingOf(mod, node.name);
    if (!imported) return null;
    // The EXISTING resolver decides what a specifier points at. `mod.imports` is
    // already keyed by local name and already applied relative paths, tsconfig
    // aliases and the workspace map — an external package simply has no entry,
    // which is exactly the rejection this grammar wants.
    const file = mod?.imports?.get(node.name);
    if (!file) return null;
    const target = parseModule(file);
    if (!target || target.error) return null;
    const init = exportedConstInit(target, imported.name);
    if (!init) return null;
    return staticPathsOf(init, target, depth + 1, nextSeen);
  }

  // Everything else — calls, member reads, `process.env`, conditionals, `let`
  // bindings (which never reach here because `programConstInit` requires `const`),
  // and any expression this grammar does not name.
  return null;
}
