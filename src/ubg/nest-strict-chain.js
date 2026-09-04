// ubg/nest-strict-chain.js — the strict proof chain carried BY `ProviderLinkage`.
//
// ADR-102 proved one Nest chain from literals and refused everything else. Its
// gate is `TypeOrmModule.forFeature([Entity])`, and on the seven pinned Nest
// applications that gate fires ZERO times — so the fact exists and never speaks.
// The differential review measured why, and measured two more things that matter
// more than the count: the Core credits a LOCAL lookalike of `typeorm` and a
// LOCAL lookalike of `@nestjs/common` with exactly the evidence it gives the real
// packages, and every `DbEffect` on a Prisma application carries `mongo/driver` —
// which is `contractFor`'s DEFAULT, not an identification.
//
// Neither of those is a soundness hole. Over-approximating an effect is the SAFE
// direction (Direction 1), and `falseProven` stays 0 either way. They are a
// PRECISION hole: nothing in the graph distinguishes "this route provably reaches
// Prisma `user.findMany`" from "something here looked like a database call".
//
// This module states that distinction, or refuses. Eight links, every one carrying
// its own provenance, and a receipt that exists only when all eight hold:
//
//   route exacte → champ injecté exact → identité de classe exacte
//     → binding Nest exact → méthode exacte → résumés bornés (≤ 3)
//     → handle ORM officiel → opération ORM officielle
//
// THE ORM PROVENANCE NEVER SUBSTITUTES FOR THE BINDING. A handle imported from
// `@prisma/client` itself, inside a class whose Nest binding is a factory, is
// `UNKNOWN` — the receipt needs both, and a chain is only as proved as its
// weakest link. This is the rule the Lab's own contract states first and the one
// a "we found the real package" shortcut would quietly delete.
//
// IT IS EVIDENCE, NEVER A PROPERTY. Same authority boundary as ADR-102 and
// ADR-104: it creates no node, removes none, changes no finding, credits no
// guard, no ownership and no `PROVEN`. Its refusal reasons are deliberately
// absent from `BOUNDARY_AFFECTS`, so a REFUSED chain degrades nothing either. The
// conservative effects the Core already reports for `useFactory`, `forwardRef`, a
// mutated aggregate or a callback are untouched — they simply never receive this
// receipt.
//
// NO SECOND GRAPH, AND NO SECOND GRAMMAR. Every primitive below is imported from
// `nest-provider.js` (the module grammar) or from `extract.js` (the resolver). A
// second walk over one shape drifts, and the one that drifted is the one nobody
// re-reads.
import path from 'node:path';
import { classInModule, parseModule, resolveExportedClass } from './extract.js';
import { entrypointId } from './schema.js';
import { factId, makeFact, record } from './kernel/facts.js';
import { writtenDirectlyIn } from './nest-provider-tapp.js';
import {
  constructorOf,
  decoratorCall,
  importSourceOf,
  methodsOf,
  moduleClassesOf,
  paramIdentifier,
  propertyOf,
  typeNameOf,
} from './nest-provider.js';

const NEST_COMMON = '@nestjs/common';

// The HTTP decorators that make a method a route, and the verb each denotes. The
// NAME is never the proof — every one of these is re-resolved to `@nestjs/common`
// before it counts (counter-example 2: a local `./nest-lookalike` exporting
// `Controller`, `Post` and `Body` registers a route in the Core today).
export const STRICT_HTTP = Object.freeze(
  new Map([
    ['Get', 'GET'],
    ['Post', 'POST'],
    ['Put', 'PUT'],
    ['Patch', 'PATCH'],
    ['Delete', 'DELETE'],
    ['Head', 'HEAD'],
    ['Options', 'OPTIONS'],
  ]),
);

// The three ORMs whose handle provenance this grammar can establish, and the
// EXACT import that establishes each. Sequelize is deliberately absent: ADR-102
// reaches it through `forFeature`, no pinned application uses it, and a handle
// grammar written from imagination refuses real code politely (ADR-103's lesson).
export const ORM_PACKAGES = Object.freeze({
  typeorm: Object.freeze({ pkg: 'typeorm', handle: 'Repository' }),
  prisma: Object.freeze({ pkg: '@prisma/client', handle: 'PrismaClient' }),
  mongoose: Object.freeze({ pkg: 'mongoose', handle: 'Model' }),
});

// Nest's own bridge packages. Mongoose REQUIRES its bridge — "initialisation
// officielle démontrée" means `@InjectModel` from `@nestjs/mongoose` AND a literal
// `MongooseModule.forFeature([...])` in the binding module, because a bare
// `Model<T>` parameter type is a type, and a type is not a provenance.
export const NEST_ORM_BRIDGES = Object.freeze({
  typeorm: '@nestjs/typeorm',
  mongoose: '@nestjs/mongoose',
});

// The operation vocabularies. Each is the set the corresponding client actually
// documents as a query entry point — a longer list is a wider claim, and an
// operation absent here yields a declared refusal, never a guess.
export const ORM_OPS = Object.freeze({
  typeorm: new Set([
    'find',
    'findBy',
    'findOne',
    'findOneBy',
    'findOneOrFail',
    'findAndCount',
    'count',
    'countBy',
    'save',
    'insert',
    'update',
    'upsert',
    'delete',
    'remove',
    'softDelete',
    'softRemove',
    'restore',
    // `increment` and `decrement` are REAL TypeORM methods and are deliberately
    // absent, exactly as they are absent from ADR-102's vocabulary and from
    // ADR-104's role table. Their argument is neither cleanly a selector nor
    // cleanly a payload, and two layers that disagree about what an operation IS
    // is worse than one layer that admits a gap. Widening this set is a wider
    // claim and owes its own measurement.
  ]),
  prisma: new Set([
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'findUnique',
    'findUniqueOrThrow',
    'create',
    'createMany',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
    'count',
    'aggregate',
    'groupBy',
  ]),
  mongoose: new Set([
    'find',
    'findOne',
    'findById',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'findOneAndDelete',
    'findByIdAndDelete',
    'findOneAndReplace',
    'create',
    'insertMany',
    'updateOne',
    'updateMany',
    'replaceOne',
    'deleteOne',
    'deleteMany',
    'countDocuments',
    'estimatedDocumentCount',
    'distinct',
    'aggregate',
    'bulkWrite',
  ]),
});

// Array methods that make a `const` binding a MUTABLE aggregate. `const` freezes
// the BINDING, never the contents — novu's `PROVIDERS` and `IMPORTS` are `const`
// and are filled by `push(...)`, so reading their initializer would state a
// binding set the program does not have.
const MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

// Why a chain that may well exist could not be stated. Closed, so the ledger
// aggregates by cause rather than by prose.
export const STRICT_REFUSALS = Object.freeze({
  ROUTE_PROVENANCE:
    'the @Controller or the HTTP decorator does not resolve to @nestjs/common — the name matches and the provenance does not',
  DECORATED_FIELD:
    'the controller constructor parameter carries a decorator other than a congruent @Inject(ClassToken), so which class arrives is a container decision',
  UNRESOLVED_CLASS:
    'the injected type does not resolve through imports, exports and re-exports to exactly one declaring class',
  NOT_INJECTABLE:
    'the provider class carries no @Injectable whose provenance is @nestjs/common',
  UNREADABLE_MODULE:
    'a provider entry has a token this grammar cannot read — a call, a conditional, a forwardRef or a spread of a mutable aggregate — so the whole binding set is a container decision',
  MUTABLE_AGGREGATE:
    'the spread aggregate is a const array mutated by push, splice or an equivalent, so its initializer is not its contents',
  NO_BINDING:
    'no literal @Module binds this class, through its own providers or through the exports of a module it imports',
  AMBIGUOUS_BINDING:
    'more than one literal binding names this token, so which implementation is live is a container decision',
  CONTAINER_BINDING:
    'the token is bound by useFactory, useValue or a shape this grammar does not read',
  CYCLIC_ALIAS: 'the useExisting alias chain is cyclic',
  MODULE_DEPTH: 'the module import chain exceeds the bounded depth',
  NO_METHOD: 'the provider class does not declare the called method',
  COMPUTED_CALL:
    'the receiver or the member is computed, so the call target is not readable',
  INDIRECT_CALL:
    'the operation is nested inside a callback, an event handler or a queue subscriber, not written directly in the method body',
  DEPTH_EXCEEDED:
    'the interprocedural chain exceeds the bounded depth of 3 provider summaries',
  ORM_PROVENANCE:
    'the handle type does not resolve to an official ORM package — a local class of the same name is not that package',
  ORM_INITIALISATION:
    'the ORM handle has no official Nest registration — no @InjectRepository/@InjectModel from the bridge package, or no literal forFeature in the modules that proved the binding',
  ORM_ENTITY_CONGRUENCE:
    'the injected entity is not the one the module registered — same name is not same entity, and a forFeature([Other]) creates no provider for Repository<Row>',
  ORM_CONNECTION:
    'the repository names a non-default connection, and this grammar reads only the default one',
  ORM_OPERATION: 'the member is outside the official operation vocabulary of this ORM',
});

// Bounded, and every bound is a refusal rather than a truncation.
export const MAX_STRICT_HOPS = 3; // "profondeur interprocédurale maximale 3"
const MAX_MODULE_DEPTH = 3;
const MAX_ALIAS = 8;
const WALK_BUDGET = 4000;

const rel = (cwd, file) => path.relative(cwd, file).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// Identity: a class reference resolved to the file that DECLARES it.
//
// ADR-102 accepts an exact relative import and nothing else, and that single rule
// is why 19 of twenty's modules decline. The strict contract asks for something
// different and not weaker — "imports, exports et réexports de modules exacts":
// the reference must land on exactly ONE declaration. A barrel that re-exports it
// is followed to the declaration; an alias is accepted only when the Core's own
// import map already resolved it to one file. What is refused is a reference that
// resolves to no declaration, or to a module the resolver could not open.
function classRefFrom(mod, local) {
  if (!mod || mod.error || !local) return null;
  // declared right here
  if (classInModule(mod, local)) return { file: mod._file, name: local };
  const spec = importSourceOf(mod, local);
  if (!spec) return null;
  const file = mod.imports?.get(local);
  if (!file) return null;
  const target = parseModule(file);
  if (!target || target.error) return null;
  // Follow named and star re-exports to the DECLARING module — this is the Core's
  // own primitive, not a second resolver.
  const hit = resolveExportedClass(target, local);
  if (!hit) return null;
  return { file: hit.mod._file, name: local };
}

const refKey = (ref) => (ref ? `${ref.file}#${ref.name}` : null);

// ---------------------------------------------------------------------------
// Aggregates: is `const X = [A, B]` REALLY immutable in this file?
function immutableArrayOf(mod, name) {
  let init = null;
  for (const node of mod?.ast?.program?.body ?? []) {
    const decl =
      node.type === 'VariableDeclaration'
        ? node
        : node.type === 'ExportNamedDeclaration' &&
            node.declaration?.type === 'VariableDeclaration'
          ? node.declaration
          : null;
    if (!decl || decl.kind !== 'const') continue;
    for (const d of decl.declarations)
      if (d.id?.type === 'Identifier' && d.id.name === name) init = d.init;
  }
  if (init?.type !== 'ArrayExpression') return null;
  const names = [];
  for (const el of init.elements) {
    if (el?.type !== 'Identifier') return null;
    names.push(el.name);
  }
  return mutatedAnywhere(mod.ast, name) ? null : names;
}

// `X.push(...)`, `X.splice(...)`, `X[0] = …`, `X = …` anywhere in the file.
// Deliberately coarse: one conservative refusal costs a declared boundary, while
// one missed mutation states a binding set the program does not have.
function mutatedAnywhere(ast, name) {
  let hit = false;
  const budget = { n: WALK_BUDGET };
  const walk = (n) => {
    if (hit || !n || typeof n !== 'object' || budget.n <= 0) return;
    budget.n -= 1;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'MemberExpression' &&
      n.callee.object?.type === 'Identifier' &&
      n.callee.object.name === name &&
      (n.callee.computed || MUTATORS.has(n.callee.property?.name))
    )
      hit = true;
    if (n.type === 'AssignmentExpression') {
      const t = n.left;
      if (t?.type === 'Identifier' && t.name === name) hit = true;
      if (
        t?.type === 'MemberExpression' &&
        t.object?.type === 'Identifier' &&
        t.object.name === name
      )
        hit = true;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const c = n[k];
      if (c && typeof c === 'object') walk(c);
    }
  };
  walk(ast?.program?.body);
  return hit;
}

// Expand an array-literal property (`controllers`, `providers`, `imports`,
// `exports`) into entry nodes, following immutable `const` spreads.
// → { nodes, fatal } — `fatal` names the ONE refusal that poisons the whole list.
function expandList(obj, key, mod) {
  const prop = propertyOf(obj, key);
  if (!prop) return { nodes: [], fatal: null };
  if (prop.value?.type !== 'ArrayExpression')
    return { nodes: [], fatal: STRICT_REFUSALS.UNREADABLE_MODULE };
  const nodes = [];
  for (const el of prop.value.elements) {
    if (el?.type !== 'SpreadElement') {
      nodes.push(el);
      continue;
    }
    if (el.argument?.type !== 'Identifier')
      return { nodes: [], fatal: STRICT_REFUSALS.UNREADABLE_MODULE };
    const names = immutableArrayOf(mod, el.argument.name);
    if (!names) return { nodes: [], fatal: STRICT_REFUSALS.MUTABLE_AGGREGATE };
    for (const n of names)
      nodes.push({ type: 'Identifier', name: n, loc: el.loc, _fromAggregate: true });
  }
  return { nodes, fatal: null };
}

// ---------------------------------------------------------------------------
// One literal `@Module`, read into a binding record.
//
// The refusal policy is per-TOKEN where the token is readable, and WHOLE-MODULE
// where it is not. That asymmetry is the whole safety argument: `{ provide: X,
// useFactory }` settles that X is a container decision and says nothing about Y,
// while a bare `forwardRef(() => …)` or a spread of a mutated array could be ANY
// token, so it unsettles the entire set (ADR-102's whole-list rule, applied at
// the level where it is actually load-bearing).
function readModule(cls, obj, mod) {
  const rec = {
    file: mod._file,
    name: cls.id?.name ?? '<module>',
    line: cls.loc?.start.line ?? 0,
    controllers: new Set(), // refKey
    tokens: new Map(), // token refKey → { impl: ref|null, kind, reason }
    aliases: new Map(), // token refKey → target refKey
    imports: [], // module class refs
    exports: new Set(), // exported token refKeys
    exportedModules: [], // module class refs re-exported wholesale
    // Which OFFICIAL ORM registrations this module declares. Mongoose needs only
    // "a literal forFeature is here"; TypeORM needs the ENTITY SET, because the
    // repository token is `getRepositoryToken(Entity)` — a `forFeature([Other])`
    // registers no provider for `Repository<Row>`, and congruence is the check
    // that says so.
    mongooseFeature: false,
    typeormEntities: new Set(), // refKey of each entity in a literal forFeature
    fatal: null,
  };

  const ctrl = expandList(obj, 'controllers', mod);
  if (ctrl.fatal) rec.fatal = ctrl.fatal;
  for (const el of ctrl.nodes) {
    if (el?.type !== 'Identifier') {
      rec.fatal ??= STRICT_REFUSALS.UNREADABLE_MODULE;
      continue;
    }
    const ref = classRefFrom(mod, el.name);
    if (ref) rec.controllers.add(refKey(ref));
  }

  const provs = expandList(obj, 'providers', mod);
  if (provs.fatal) rec.fatal ??= provs.fatal;
  for (const el of provs.nodes) {
    if (el?.type === 'Identifier') {
      const ref = classRefFrom(mod, el.name);
      if (!ref) continue; // a token this file does not resolve — it binds no class here
      bind(rec, refKey(ref), { impl: ref, kind: 'class', reason: null });
      continue;
    }
    if (el?.type === 'ObjectExpression') {
      readObjectProvider(rec, el, mod);
      continue;
    }
    // A call (`forwardRef(() => X)`), a conditional, a logical or anything else:
    // the TOKEN is unreadable, so it could shadow any binding in this module.
    rec.fatal ??= STRICT_REFUSALS.UNREADABLE_MODULE;
  }

  const imps = expandList(obj, 'imports', mod);
  for (const el of imps.nodes) {
    if (el?.type === 'Identifier') {
      const ref = classRefFrom(mod, el.name);
      if (ref) rec.imports.push(ref);
      continue;
    }
    // `MongooseModule.forFeature([...])` — the official initialisation, proved by
    // the same provenance rule as everything else.
    if (isOfficialForFeature(el, mod, NEST_ORM_BRIDGES.mongoose, 'MongooseModule'))
      rec.mongooseFeature = true;
    // `TypeOrmModule.forFeature([Row])` — the registration that actually creates
    // the `Repository<Row>` provider. A second argument names a NON-DEFAULT
    // connection, and this grammar reads only the default one, so it registers
    // nothing here rather than registering the wrong thing.
    const feature = isOfficialForFeature(
      el,
      mod,
      NEST_ORM_BRIDGES.typeorm,
      'TypeOrmModule',
    );
    if (feature && el.arguments.length === 1)
      for (const e of el.arguments[0].elements ?? []) {
        if (e?.type !== 'Identifier') continue;
        const ref = classRefFrom(mod, e.name);
        if (ref) rec.typeormEntities.add(refKey(ref));
      }
    // A dynamic module (`X.forRoot()`, `forwardRef(...)`) contributes bindings this
    // grammar cannot read. It does NOT poison the module's own literal providers —
    // it simply exports nothing this chain will follow.
  }

  const exps = expandList(obj, 'exports', mod);
  for (const el of exps.nodes) {
    if (el?.type !== 'Identifier') continue;
    const ref = classRefFrom(mod, el.name);
    if (!ref) continue;
    rec.exports.add(refKey(ref));
    rec.exportedModules.push(ref);
  }
  return rec;
}

function bind(rec, token, entry) {
  if (rec.tokens.has(token)) {
    rec.tokens.set(token, {
      impl: null,
      kind: 'ambiguous',
      reason: STRICT_REFUSALS.AMBIGUOUS_BINDING,
    });
    return;
  }
  rec.tokens.set(token, entry);
}

function readObjectProvider(rec, obj, mod) {
  const provide = propertyOf(obj, 'provide');
  if (!provide) {
    rec.fatal ??= STRICT_REFUSALS.UNREADABLE_MODULE;
    return;
  }
  // A string or symbol token cannot shadow a CLASS token, so it is benign here —
  // it binds a name this chain never asks about.
  if (provide.value?.type !== 'Identifier') return;
  const token = classRefFrom(mod, provide.value.name);
  if (!token) return; // an injection token that is not a class — benign, same reason
  const key = refKey(token);

  const useClass = propertyOf(obj, 'useClass');
  if (useClass) {
    const impl =
      useClass.value?.type === 'Identifier'
        ? classRefFrom(mod, useClass.value.name)
        : null;
    bind(
      rec,
      key,
      impl
        ? { impl, kind: 'useClass', reason: null }
        : { impl: null, kind: 'unreadable', reason: STRICT_REFUSALS.CONTAINER_BINDING },
    );
    return;
  }
  const useExisting = propertyOf(obj, 'useExisting');
  if (useExisting) {
    const target =
      useExisting.value?.type === 'Identifier'
        ? classRefFrom(mod, useExisting.value.name)
        : null;
    if (!target) {
      bind(rec, key, {
        impl: null,
        kind: 'unreadable',
        reason: STRICT_REFUSALS.CONTAINER_BINDING,
      });
      return;
    }
    bind(rec, key, { impl: null, kind: 'useExisting', reason: null });
    rec.aliases.set(key, refKey(target));
    return;
  }
  // useFactory, useValue, or a shape this grammar does not read. The TOKEN is
  // readable, so exactly this token is a container decision and no other.
  bind(rec, key, {
    impl: null,
    kind: 'container',
    reason: STRICT_REFUSALS.CONTAINER_BINDING,
  });
}

// `MongooseModule.forFeature([...])` with `MongooseModule` proved to be the named
// export of `@nestjs/mongoose`.
function isOfficialForFeature(el, mod, pkg, name) {
  if (
    el?.type !== 'CallExpression' ||
    el.callee?.type !== 'MemberExpression' ||
    el.callee.computed ||
    el.callee.object?.type !== 'Identifier' ||
    el.callee.object.name !== name ||
    el.callee.property?.name !== 'forFeature'
  )
    return false;
  const bound = importSourceOf(mod, name);
  if (bound?.source !== pkg || bound.imported !== name) return false;
  return el.arguments[0]?.type === 'ArrayExpression';
}

// Every literal `@Module` in the tree, read once. Uniqueness and reachability are
// properties of the WHOLE module set, and a check that only saw the modules
// visited so far would answer differently depending on directory-walk order —
// the exact defect that made ADR-105's binding thunk memoise an empty map.
export function readModuleGraph(moduleFiles) {
  const modules = [];
  for (const file of moduleFiles) {
    const mod = parseModule(file);
    if (!mod || mod.error) continue;
    for (const { cls, obj } of moduleClassesOf(mod))
      modules.push(readModule(cls, obj, mod));
  }
  const byKey = new Map();
  for (const m of modules) byKey.set(`${m.file}#${m.name}`, m);
  return { modules, byKey };
}

// ---------------------------------------------------------------------------
// Link 4 — the exact Nest binding.
//
// → { impl, module, via, kind } or { refusal }. `via` is the ordered module hops,
// so the receipt can name WHERE the binding was found rather than merely that it
// was.
function resolveBinding(graph, homeModule, tokenKey) {
  const found = [];
  const seen = new Set();

  const localImpl = (mod, key) => {
    let cur = key;
    for (let i = 0; i <= MAX_ALIAS; i += 1) {
      const entry = mod.tokens.get(cur);
      if (!entry) return null;
      if (entry.kind === 'useExisting') {
        const next = mod.aliases.get(cur);
        if (!next || next === cur) return { refusal: STRICT_REFUSALS.CYCLIC_ALIAS };
        cur = next;
        continue;
      }
      return entry.impl
        ? { impl: entry.impl, kind: i === 0 ? entry.kind : 'useExisting' }
        : { refusal: entry.reason ?? STRICT_REFUSALS.CONTAINER_BINDING };
    }
    return { refusal: STRICT_REFUSALS.CYCLIC_ALIAS };
  };

  const visit = (mod, via, depth, mustExport) => {
    if (!mod || depth > MAX_MODULE_DEPTH) return;
    const id = `${mod.file}#${mod.name}`;
    if (seen.has(`${id}|${depth}`)) return;
    seen.add(`${id}|${depth}`);
    if (mod.fatal) {
      found.push({ refusal: mod.fatal, module: mod, via });
      return;
    }
    if (mod.tokens.has(tokenKey) && (!mustExport || mod.exports.has(tokenKey))) {
      const hit = localImpl(mod, tokenKey);
      if (hit) found.push({ ...hit, module: mod, via });
    }
    for (const ref of mod.imports) {
      const next = graph.byKey.get(refKey(ref));
      if (!next) continue;
      visit(
        next,
        [...via, { file: next.file, name: next.name, line: next.line }],
        depth + 1,
        true,
      );
    }
  };

  visit(homeModule, [], 0, false);
  if (!found.length) return { refusal: STRICT_REFUSALS.NO_BINDING };
  const refused = found.find((f) => f.refusal);
  if (refused) return { refusal: refused.refusal };
  const distinct = new Set(found.map((f) => refKey(f.impl)));
  if (distinct.size > 1) return { refusal: STRICT_REFUSALS.AMBIGUOUS_BINDING };
  const best = found[0];
  return {
    impl: best.impl,
    kind: best.kind,
    module: { file: best.module.file, name: best.module.name, line: best.module.line },
    via: best.via,
    // The registrations visible along the SAME module path that proved the
    // binding. A `forFeature` in an unrelated module registers nothing for this
    // provider, so the union is taken over the modules this chain actually
    // travelled — never over the whole tree.
    mongooseFeature: found.some((f) => f.module?.mongooseFeature),
    typeormEntities: new Set(
      found.flatMap((f) => [...(f.module?.typeormEntities ?? [])]),
    ),
  };
}

// ---------------------------------------------------------------------------
// `@Injectable()` whose provenance IS `@nestjs/common`. Counter-example: a local
// `./nest-lookalike` exporting `Injectable` is a shape that exists in the wild.
function injectableProvenance(cls, mod) {
  for (const dec of cls.decorators ?? []) {
    const call = decoratorCall(dec);
    const name = call?.callee?.type === 'Identifier' ? call.callee.name : null;
    if (name !== 'Injectable') continue;
    const bound = importSourceOf(mod, 'Injectable');
    if (bound?.source === NEST_COMMON && bound.imported === 'Injectable')
      return NEST_COMMON;
  }
  return null;
}

// A congruent `@Inject(ClassToken)`: the token is the SAME class the parameter's
// type names. Anything else — a string token, a computed token, a different class
// — hands the choice to the container and is refused.
function injectCongruence(param, id, mod, typeRef) {
  const decorators = [
    ...new Set([...(param.decorators ?? []), ...(id.decorators ?? [])]),
  ];
  if (!decorators.length) return { ok: true, kind: 'typed' };
  if (decorators.length !== 1) return { ok: false };
  const call = decoratorCall(decorators[0]);
  if (call?.callee?.type !== 'Identifier' || call.callee.name !== 'Inject')
    return { ok: false };
  const bound = importSourceOf(mod, 'Inject');
  if (bound?.source !== NEST_COMMON || bound.imported !== 'Inject') return { ok: false };
  const arg = call.arguments[0];
  if (arg?.type !== 'Identifier') return { ok: false };
  const tokenRef = classRefFrom(mod, arg.name);
  if (!tokenRef || !typeRef || refKey(tokenRef) !== refKey(typeRef)) return { ok: false };
  return { ok: true, kind: 'inject-token' };
}

// ---------------------------------------------------------------------------
// Link 7 — official ORM handles on a provider class.
//
// → Map<field, { orm, pkg, type, entity, line, needsBridge }>. Every entry has a
// PROVENANCE: the handle type is resolved to the official package, or the field
// is simply not a handle.
function ormHandlesOf(cls, mod) {
  const out = new Map();
  for (const p of constructorOf(cls)?.params ?? []) {
    const id = paramIdentifier(p);
    const type = typeNameOf(id);
    if (!id || !type) continue;
    const line = id.loc?.start.line ?? cls.loc?.start.line ?? 0;
    const decorators = [...new Set([...(p.decorators ?? []), ...(id.decorators ?? [])])];

    // TypeORM: `Repository<E>` imported from `typeorm` itself.
    const direct = importSourceOf(mod, type);
    if (
      type === ORM_PACKAGES.typeorm.handle &&
      direct?.source === ORM_PACKAGES.typeorm.pkg &&
      direct.imported === ORM_PACKAGES.typeorm.handle
    ) {
      // THE BRIDGE IS NOT OPTIONAL, and this is the correction of a real leak.
      // `constructor(private readonly repo: Repository<Row>)` with no
      // `@InjectRepository` and no `TypeOrmModule.forFeature([Row])` is a
      // dependency NO module registers — such an application does not even
      // resolve at runtime. The `typeorm` import proves the PACKAGE; it proves
      // nothing about the CONTAINER, and letting it stand in for the binding is
      // precisely "the ORM provenance replacing the Nest binding".
      const bridge = injectBridgeOf(
        decorators,
        mod,
        NEST_ORM_BRIDGES.typeorm,
        'InjectRepository',
      );
      out.set(id.name, {
        orm: 'typeorm',
        pkg: ORM_PACKAGES.typeorm.pkg,
        type,
        entity: bridge?.name ?? null,
        entityRef: bridge?.ref ?? null,
        defaultConnection: bridge?.defaultConnection ?? false,
        line,
        needsBridge: true,
      });
      continue;
    }

    // Mongoose: `Model<T>` from `mongoose`, initialised through `@nestjs/mongoose`.
    if (
      type === ORM_PACKAGES.mongoose.handle &&
      direct?.source === ORM_PACKAGES.mongoose.pkg &&
      direct.imported === ORM_PACKAGES.mongoose.handle
    ) {
      const model =
        injectBridgeOf(decorators, mod, NEST_ORM_BRIDGES.mongoose, 'InjectModel')?.name ??
        null;
      out.set(id.name, {
        orm: 'mongoose',
        pkg: ORM_PACKAGES.mongoose.pkg,
        type,
        entity: model,
        line,
        needsBridge: true,
      });
      continue;
    }

    // Prisma: a local class that EXTENDS `PrismaClient` imported from
    // `@prisma/client`. This is the shape every Nest/Prisma application writes,
    // and the one the Core labels `mongo/driver` today because `contractFor` has
    // no Prisma branch and falls through to its default.
    const via = prismaSuperclass(mod, type);
    if (via) {
      out.set(id.name, {
        orm: 'prisma',
        pkg: ORM_PACKAGES.prisma.pkg,
        type,
        entity: null,
        line,
        needsBridge: false,
        superclassFile: via.file,
      });
    }
  }
  return out;
}

// Fields that WOULD be official handles if their provenance held — the exact
// counter-examples the differential review measured: a local `./fake-typeorm`
// exporting `Repository`, and a local `./prisma-lookalike` exporting
// `PrismaClient`. Without this, such a field is simply not a handle and the ORM
// call is neither modelled nor DECLARED, which is the silence hard rule 9 exists
// to forbid.
//
// Deliberately keyed on the official handle NAME, not on "any member call": a
// grammar that declared every `this.logger.log()` would bury the ledger, and the
// lookalike shape is exactly a name that matches with a provenance that does not.
function lookalikeHandlesOf(cls, mod, real) {
  const out = new Map();
  const names = new Set(Object.values(ORM_PACKAGES).map((o) => o.handle));
  for (const p of constructorOf(cls)?.params ?? []) {
    const id = paramIdentifier(p);
    const type = typeNameOf(id);
    if (!id || !type || real.has(id.name)) continue;
    const line = id.loc?.start.line ?? 0;
    if (names.has(type)) {
      out.set(id.name, { type, line });
      continue;
    }
    // The Prisma shape is one level down: the FIELD's type is a local service, and
    // the lookalike is its superclass.
    const ref = classRefFrom(mod, type);
    const owner = ref ? parseModule(ref.file) : null;
    const target = owner && !owner.error ? classInModule(owner, ref.name) : null;
    if (target?.superClass?.type === 'Identifier' && names.has(target.superClass.name))
      out.set(id.name, { type: target.superClass.name, line });
  }
  return out;
}

// A computed receiver or a computed member on a field this grammar tracks —
// `this.repo['find']()`, `this['repo'].find()`. The call target is not readable,
// and an unreadable target that says nothing is indistinguishable from no call.
function computedCallsOn(fn, fields) {
  const out = [];
  const budget = { n: WALK_BUDGET };
  const walk = (n) => {
    if (!n || typeof n !== 'object' || budget.n <= 0) return;
    budget.n -= 1;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression') {
      const o = n.callee.object;
      if (
        n.callee.computed &&
        o?.type === 'MemberExpression' &&
        !o.computed &&
        o.object?.type === 'ThisExpression' &&
        o.property?.type === 'Identifier' &&
        fields.has(o.property.name)
      )
        out.push({ field: o.property.name, line: n.loc?.start.line ?? 0 });
      if (
        o?.type === 'MemberExpression' &&
        o.computed &&
        o.object?.type === 'ThisExpression'
      )
        out.push({ field: '<computed>', line: n.loc?.start.line ?? 0 });
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const c = n[k];
      if (c && typeof c === 'object') walk(c);
    }
  };
  walk(fn?.body);
  return out;
}

// `@InjectRepository(User)` / `@InjectModel(Cat.name)` — the DECORATOR's own
// provenance, then its literal argument, then the CONNECTION.
//
// → { name, ref, defaultConnection } or null. `ref` is the entity resolved to its
// declaring file, because congruence is an identity question: two `User` classes
// in two files are two entities, and a module that registered one says nothing
// about the other (ADR-102's rule, and the reason a NAME is never the answer).
//
// A SECOND argument names a non-default connection. This grammar reads only the
// default one, so it reports `defaultConnection: false` rather than pretending
// the named connection is the one the module registered.
function injectBridgeOf(decorators, mod, pkg, name) {
  for (const dec of decorators) {
    const call = decoratorCall(dec);
    if (call?.callee?.type !== 'Identifier' || call.callee.name !== name) continue;
    const bound = importSourceOf(mod, name);
    if (bound?.source !== pkg || bound.imported !== name) return null;
    const defaultConnection = call.arguments.length === 1;
    const arg = call.arguments[0];
    if (arg?.type === 'Identifier')
      return { name: arg.name, ref: classRefFrom(mod, arg.name), defaultConnection };
    // `Cat.name` — the exact member of an exact class reference.
    if (
      arg?.type === 'MemberExpression' &&
      !arg.computed &&
      arg.object?.type === 'Identifier' &&
      arg.property?.type === 'Identifier'
    )
      return {
        name: `${arg.object.name}.${arg.property.name}`,
        ref: classRefFrom(mod, arg.object.name),
        defaultConnection,
      };
    return null;
  }
  return null;
}

// Why an official handle still has no official REGISTRATION. Returns `null` when
// the bridge holds.
//
// This is the link the first implementation was missing entirely for TypeORM,
// and its absence was a proof leak: the receipt said "binding Nest exact" while
// proving the binding only for the PROVIDER CLASS, never for the ORM HANDLE the
// route actually reaches. Prisma needs no branch here — its handle IS an
// `@Injectable` class in a `providers` list, so `resolveBinding` already proved
// it by the ordinary rule.
function bridgeRefusal(handle, binding) {
  if (handle.orm === 'mongoose')
    return handle.entity && binding.mongooseFeature
      ? null
      : STRICT_REFUSALS.ORM_INITIALISATION;
  if (handle.orm === 'typeorm') {
    if (!handle.entityRef) return STRICT_REFUSALS.ORM_INITIALISATION;
    if (!handle.defaultConnection) return STRICT_REFUSALS.ORM_CONNECTION;
    if (!binding.typeormEntities?.size) return STRICT_REFUSALS.ORM_INITIALISATION;
    return binding.typeormEntities.has(refKey(handle.entityRef))
      ? null
      : STRICT_REFUSALS.ORM_ENTITY_CONGRUENCE;
  }
  return null;
}

// Does `type` resolve to a class whose superclass is `PrismaClient`, imported by
// THAT class's own module from `@prisma/client`? A local `./prisma-lookalike`
// exporting its own `PrismaClient` stops here.
function prismaSuperclass(mod, type) {
  const ref = classRefFrom(mod, type);
  if (!ref) return null;
  const owner = parseModule(ref.file);
  const cls = owner && !owner.error ? classInModule(owner, ref.name) : null;
  if (!cls || cls.superClass?.type !== 'Identifier') return null;
  if (cls.superClass.name !== ORM_PACKAGES.prisma.handle) return null;
  const bound = importSourceOf(owner, ORM_PACKAGES.prisma.handle);
  if (
    bound?.source !== ORM_PACKAGES.prisma.pkg ||
    bound.imported !== ORM_PACKAGES.prisma.handle
  )
    return null;
  return { file: ref.file, name: ref.name };
}

// ---------------------------------------------------------------------------
// Link 8 — an official operation on an official handle, written DIRECTLY in the
// body. Two call shapes, because the clients differ:
//
//   this.repo.find(...)                 typeorm / mongoose  (2 levels)
//   this.prisma.user.findMany(...)      prisma              (3 levels)
function ormCallsIn(fn, handles) {
  const out = [];
  const budget = { n: WALK_BUDGET };
  const walk = (n) => {
    if (!n || typeof n !== 'object' || budget.n <= 0) return;
    budget.n -= 1;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression') {
      const hit = readOrmCall(n, handles);
      if (hit) out.push(hit);
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const c = n[k];
      if (c && typeof c === 'object') walk(c);
    }
  };
  walk(fn?.body);
  return out;
}

function readOrmCall(node, handles) {
  const callee = node.callee;
  if (callee.computed || callee.property?.type !== 'Identifier') return null;
  const member = callee.property.name;
  const obj = callee.object;
  if (obj?.type !== 'MemberExpression' || obj.computed) return null;

  // 2-level: this.<field>.<op>()
  if (obj.object?.type === 'ThisExpression' && obj.property?.type === 'Identifier') {
    const handle = handles.get(obj.property.name);
    if (!handle || handle.orm === 'prisma') return null;
    return {
      field: obj.property.name,
      model: null,
      op: member,
      node,
      line: node.loc?.start.line ?? 0,
    };
  }
  // 3-level: this.<field>.<model>.<op>()
  const inner = obj.object;
  if (
    inner?.type === 'MemberExpression' &&
    !inner.computed &&
    inner.object?.type === 'ThisExpression' &&
    inner.property?.type === 'Identifier' &&
    obj.property?.type === 'Identifier'
  ) {
    const handle = handles.get(inner.property.name);
    if (!handle || handle.orm !== 'prisma') return null;
    return {
      field: inner.property.name,
      model: obj.property.name,
      op: member,
      node,
      line: node.loc?.start.line ?? 0,
    };
  }
  return null;
}

// Calls on OTHER injected fields, and on `this.<method>()` of the same class —
// the two shapes a bounded interprocedural summary follows.
function delegationsIn(fn, fields) {
  const out = [];
  const budget = { n: WALK_BUDGET };
  const walk = (n) => {
    if (!n || typeof n !== 'object' || budget.n <= 0) return;
    budget.n -= 1;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'MemberExpression' &&
      !n.callee.computed
    ) {
      const callee = n.callee;
      if (
        callee.object?.type === 'MemberExpression' &&
        !callee.object.computed &&
        callee.object.object?.type === 'ThisExpression' &&
        callee.object.property?.type === 'Identifier' &&
        callee.property?.type === 'Identifier' &&
        fields.has(callee.object.property.name)
      )
        out.push({
          field: callee.object.property.name,
          member: callee.property.name,
          node: n,
          line: n.loc?.start.line ?? 0,
        });
      if (
        callee.object?.type === 'ThisExpression' &&
        callee.property?.type === 'Identifier'
      )
        out.push({
          field: null,
          member: callee.property.name,
          node: n,
          line: n.loc?.start.line ?? 0,
        });
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const c = n[k];
      if (c && typeof c === 'object') walk(c);
    }
  };
  walk(fn?.body);
  return out;
}

// ---------------------------------------------------------------------------
// Every strictly-bound constructor field of a class, with the class it resolves
// to. Shared by the controller (link 2/3) and by every provider hop, because a
// delegation is only followed when its own binding is proved — that is what makes
// "the ORM provenance never substitutes for the binding" true at every depth, not
// only at the first one.
function boundFieldsOf(cls, mod, graph, homeModule, declare, skip = new Set()) {
  const out = new Map();
  for (const p of constructorOf(cls)?.params ?? []) {
    const id = paramIdentifier(p);
    const type = typeNameOf(id);
    if (!id || !type || skip.has(id.name)) continue;
    const typeRef = classRefFrom(mod, type);
    // A parameter whose type is not a local class is not a provider field at all —
    // an ORM handle, a package type, a primitive. Declaring those would drown the
    // ledger in stops that were never registrations (ADR-103's `isRequiredModuleArg`
    // lesson), and `ormHandlesOf` is what speaks for the handles.
    if (!typeRef) continue;
    const congruent = injectCongruence(p, id, mod, typeRef);
    if (!congruent.ok) {
      declare(
        STRICT_REFUSALS.DECORATED_FIELD,
        `${cls.id?.name}.${id.name}`,
        id.loc?.start.line ?? 0,
      );
      continue;
    }
    const binding = resolveBinding(graph, homeModule, refKey(typeRef));
    if (binding.refusal) {
      declare(binding.refusal, `${cls.id?.name}.${id.name}`, id.loc?.start.line ?? 0);
      continue;
    }
    const implMod = parseModule(binding.impl.file);
    const implCls =
      implMod && !implMod.error ? classInModule(implMod, binding.impl.name) : null;
    if (!implCls) {
      declare(
        STRICT_REFUSALS.UNRESOLVED_CLASS,
        `${cls.id?.name}.${id.name}`,
        id.loc?.start.line ?? 0,
      );
      continue;
    }
    const injectable = injectableProvenance(implCls, implMod);
    if (!injectable) {
      declare(
        STRICT_REFUSALS.NOT_INJECTABLE,
        binding.impl.name,
        implCls.loc?.start.line ?? 0,
      );
      continue;
    }
    out.set(id.name, {
      field: id.name,
      fieldLine: id.loc?.start.line ?? 0,
      declaredType: type,
      typeRef,
      binding,
      cls: implCls,
      mod: implMod,
      injection: congruent.kind,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The bounded interprocedural summary. `hops` is the ordered chain, never longer
// than MAX_HOPS, and a chain that WOULD be longer is refused rather than
// truncated — a truncated chain reads downstream exactly like a chain that ended.
function summarise({ target, methodName, graph, homeModule, hops, declare, seen }) {
  const receipts = [];
  const method = methodsOf(target.cls).find((m) => m.key.name === methodName);
  if (!method) {
    declare(
      STRICT_REFUSALS.NO_METHOD,
      `${target.binding.impl.name}.${methodName}`,
      target.cls.loc?.start.line ?? 0,
    );
    return receipts;
  }
  const hop = {
    file: target.binding.impl.file,
    class: target.binding.impl.name,
    method: methodName,
    line: method.loc?.start.line ?? 0,
    binding: target.binding.kind,
    module: target.binding.module,
    via: target.binding.via,
  };
  const chain = [...hops, hop];

  const handles = ormHandlesOf(target.cls, target.mod);
  // A name that matches an official handle with a provenance that does not. This
  // is counter-example 1 (`./fake-typeorm`) and counter-example 3
  // (`./prisma-lookalike`): without this declaration the call is invisible, and an
  // invisible refusal reads downstream exactly like no call at all.
  const fake = lookalikeHandlesOf(target.cls, target.mod, handles);
  for (const [field, info] of fake)
    declare(
      STRICT_REFUSALS.ORM_PROVENANCE,
      `${hop.class}.${field}:${info.type}`,
      info.line,
    );
  for (const c of computedCallsOn(method, new Set([...handles.keys(), ...fake.keys()])))
    declare(
      STRICT_REFUSALS.COMPUTED_CALL,
      `${hop.class}.${methodName}.${c.field}`,
      c.line,
    );

  for (const call of ormCallsIn(method, handles)) {
    const handle = handles.get(call.field);
    if (!writtenDirectlyIn(method, call.node)) {
      declare(
        STRICT_REFUSALS.INDIRECT_CALL,
        `${hop.class}.${methodName}.${call.op}`,
        call.line,
      );
      continue;
    }
    if (!ORM_OPS[handle.orm].has(call.op)) {
      declare(
        STRICT_REFUSALS.ORM_OPERATION,
        `${hop.class}.${methodName}.${call.op}`,
        call.line,
      );
      continue;
    }
    if (handle.needsBridge) {
      const why = bridgeRefusal(handle, target.binding);
      if (why) {
        declare(why, `${hop.class}.${call.field}`, handle.line);
        continue;
      }
    }
    receipts.push({
      hops: chain,
      handle: {
        field: call.field,
        orm: handle.orm,
        pkg: handle.pkg,
        type: handle.type,
        entity: handle.entity,
        model: call.model,
        file: hop.file,
        line: handle.line,
      },
      operation: { name: call.op, file: hop.file, line: call.line },
    });
  }

  const skip = new Set([...handles.keys(), ...fake.keys()]);
  const fields = boundFieldsOf(target.cls, target.mod, graph, homeModule, declare, skip);

  if (chain.length >= MAX_STRICT_HOPS) {
    // Anything one level deeper would be hop 4. Declared, never truncated: a
    // truncated chain reads downstream exactly like a chain that ended.
    for (const d of delegationsIn(method, new Set(fields.keys())))
      if (d.field)
        declare(
          STRICT_REFUSALS.DEPTH_EXCEEDED,
          `${hop.class}.${methodName}→${d.field}.${d.member}`,
          d.line,
        );
    return receipts;
  }

  for (const d of delegationsIn(method, new Set(fields.keys()))) {
    if (!writtenDirectlyIn(method, d.node)) {
      declare(
        STRICT_REFUSALS.INDIRECT_CALL,
        `${hop.class}.${methodName}→${d.member}`,
        d.line,
      );
      continue;
    }
    // `this.<method>()` on the same class: one summary deeper, same class identity.
    const next = d.field ? fields.get(d.field) : target;
    if (!next) continue;
    const key = `${next.binding.impl.file}#${next.binding.impl.name}.${d.member}`;
    if (seen.has(key)) {
      declare(STRICT_REFUSALS.CYCLIC_ALIAS, key, d.line);
      continue;
    }
    seen.add(key);
    receipts.push(
      ...summarise({
        target: next,
        methodName: d.member,
        graph,
        homeModule,
        hops: chain,
        declare,
        seen,
      }),
    );
    seen.delete(key);
  }
  return receipts;
}

// ---------------------------------------------------------------------------
// Link 1 — the exact route.
//
// The Core's route table is built by matching decorator NAMES. This re-derives
// the same method's provenance and refuses when it does not resolve, which is the
// entire content of counter-example 2: a local `./nest-lookalike` exporting
// `Controller`, `Post` and `Body` produces a route in the Core today, and it must
// produce no STRICT route.
function strictRouteOf(cls, mod, method) {
  const ctrl = (cls.decorators ?? [])
    .map((d) => decoratorCall(d))
    .find((c) => c?.callee?.type === 'Identifier' && c.callee.name === 'Controller');
  if (!ctrl) return null;
  const ctrlBound = importSourceOf(mod, 'Controller');
  if (ctrlBound?.source !== NEST_COMMON || ctrlBound.imported !== 'Controller')
    return { refusal: STRICT_REFUSALS.ROUTE_PROVENANCE };
  for (const dec of method.decorators ?? []) {
    const call = decoratorCall(dec);
    const name = call?.callee?.type === 'Identifier' ? call.callee.name : null;
    if (!name || !STRICT_HTTP.has(name)) continue;
    const bound = importSourceOf(mod, name);
    if (bound?.source !== NEST_COMMON || bound.imported !== name)
      return { refusal: STRICT_REFUSALS.ROUTE_PROVENANCE };
    return { verb: STRICT_HTTP.get(name), decorator: name, pkg: NEST_COMMON };
  }
  return null;
}

function declarer(ledger, cwd) {
  return (file, line, symbol, detail) => {
    if (!ledger) return;
    const at = rel(cwd, file);
    record(
      ledger,
      makeFact(
        'UnknownBoundary',
        factId('UnknownBoundary', at, line, `nest-strict:${detail}:${symbol}`),
        { symbol, detail, owner: null },
        {
          file: at,
          line,
          symbol,
          contract: 'nest/strict-chain',
          // Deliberately the SAME closed reason ADR-102 uses, and deliberately
          // NOT in `BOUNDARY_AFFECTS`: a refused strict chain must degrade
          // nothing, or this slice would move verdicts by refusing.
          uncertainty: 'unresolved-provider',
        },
      ),
    );
  };
}

// ---------------------------------------------------------------------------
// → strict receipts, one per (route, chain, operation). `routes` is the lowering's
// OWN route list, so a receipt can only ever name a route the graph already has.
export function nestStrictProviderChains({ cwd, moduleFiles, routes, ledger = null }) {
  const graph = readModuleGraph(moduleFiles);
  const routeAt = new Map();
  for (const r of routes) routeAt.set(`${r.sourceFile}#${r.sourceLine}`, r);
  const declareAt = declarer(ledger, cwd);
  const out = [];

  for (const home of graph.modules) {
    for (const ctrlKey of home.controllers) {
      const [ctrlFile, ctrlName] = splitKey(ctrlKey);
      const ctrlMod = parseModule(ctrlFile);
      const ctrlCls = ctrlMod && !ctrlMod.error ? classInModule(ctrlMod, ctrlName) : null;
      if (!ctrlCls) continue;
      const ctrlRel = rel(cwd, ctrlFile);
      const declare = (detail, symbol, line) => declareAt(ctrlFile, line, symbol, detail);

      const fields = boundFieldsOf(ctrlCls, ctrlMod, graph, home, declare);
      if (!fields.size) continue;

      for (const method of methodsOf(ctrlCls)) {
        const route = routeAt.get(`${ctrlRel}#${method.loc?.start.line ?? 0}`);
        if (!route) continue;
        const strictRoute = strictRouteOf(ctrlCls, ctrlMod, method);
        if (!strictRoute) continue;
        if (strictRoute.refusal) {
          declare(
            strictRoute.refusal,
            `${ctrlName}.${method.key.name}`,
            method.loc?.start.line ?? 0,
          );
          continue;
        }
        for (const d of delegationsIn(method, new Set(fields.keys()))) {
          if (!d.field) continue; // a private controller method is not a provider hop
          if (!writtenDirectlyIn(method, d.node)) {
            declare(
              STRICT_REFUSALS.INDIRECT_CALL,
              `${ctrlName}.${method.key.name}→${d.member}`,
              d.line,
            );
            continue;
          }
          const target = fields.get(d.field);
          const declareIn = (detail, symbol, line) =>
            declareAt(target.binding.impl.file, line, symbol, detail);
          const receipts = summarise({
            target,
            methodName: d.member,
            graph,
            homeModule: home,
            hops: [],
            declare: declareIn,
            seen: new Set([
              `${target.binding.impl.file}#${target.binding.impl.name}.${d.member}`,
            ]),
          });
          for (const r of receipts)
            out.push(
              assemble({
                cwd,
                route,
                strictRoute,
                ctrlRel,
                ctrlName,
                ctrlCls,
                method,
                target,
                r,
              }),
            );
        }
      }
    }
  }
  out.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  return out;
}

const keyOf = (r) =>
  `${r.entrypoint}|${r.strict.hops.at(-1).file}|${r.line}|${r.op}|${r.strict.handle.model ?? ''}`;

const splitKey = (key) => {
  const i = key.lastIndexOf('#');
  return [key.slice(0, i), key.slice(i + 1)];
};

// The receipt. EVERY link carries its own provenance — that is the contract, and
// a receipt missing one is not a weaker receipt, it is not a receipt.
function assemble({
  cwd,
  route,
  strictRoute,
  ctrlRel,
  ctrlName,
  ctrlCls,
  method,
  target,
  r,
}) {
  const last = r.hops.at(-1);
  const relHop = (h) => ({
    ...h,
    file: rel(cwd, h.file),
    module: h.module ? { ...h.module, file: rel(cwd, h.module.file) } : null,
    via: (h.via ?? []).map((v) => ({ ...v, file: rel(cwd, v.file) })),
  });
  return {
    entrypoint: entrypointId(route.method, route.path),
    controller: `${ctrlName}.${method.key.name}`,
    controllerFile: ctrlRel,
    provider: `${last.class}.${last.method}`,
    providerFile: rel(cwd, last.file),
    orm: r.handle.orm,
    pkg: r.handle.pkg,
    op: r.operation.name,
    entity: r.handle.entity ?? r.handle.model ?? null,
    entityFile: null,
    line: r.operation.line,
    flows: [],
    strict: {
      route: {
        method: route.method,
        path: route.path,
        file: ctrlRel,
        line: method.loc?.start.line ?? 0,
        controller: ctrlName,
        controllerLine: ctrlCls.loc?.start.line ?? 0,
        decorator: strictRoute.decorator,
        pkg: strictRoute.pkg,
      },
      field: {
        name: target.field,
        line: target.fieldLine,
        declaredType: target.declaredType,
        injection: target.injection,
      },
      identity: {
        file: rel(cwd, target.binding.impl.file),
        name: target.binding.impl.name,
      },
      binding: {
        kind: target.binding.kind,
        module: { ...target.binding.module, file: rel(cwd, target.binding.module.file) },
        via: target.binding.via.map((v) => ({ ...v, file: rel(cwd, v.file) })),
      },
      method: {
        file: rel(cwd, r.hops[0].file),
        name: r.hops[0].method,
        line: r.hops[0].line,
      },
      hops: r.hops.map(relHop),
      depth: r.hops.length,
      handle: { ...r.handle, file: rel(cwd, r.handle.file) },
      operation: { ...r.operation, file: rel(cwd, r.operation.file) },
    },
  };
}

// ---------------------------------------------------------------------------
// Merge into the ADR-102 linkage list. ONE fact kind, one list, no second graph:
// where both grammars prove the same chain the receipt is ATTACHED to the
// existing fact, and where only the strict grammar proves it a new linkage record
// carries it. Every legacy link gets `strict: null` — the admission INSIDE the
// value, never beside it (rule 13).
export function mergeStrictReceipts(linkages, strict) {
  const key = (l) => `${l.entrypoint}|${l.providerFile}|${l.line}|${l.op}`;
  const byKey = new Map();
  for (const l of linkages) {
    l.strict = null;
    // Which GRAMMAR produced the record, so a consumer can ask about one without
    // having to infer it from a package name. ADR-102's own suite reads it: its
    // refusals are statements about ITS contract, and the strict contract accepts
    // three shapes ADR-102 refuses on purpose (a congruent `@Inject(ClassToken)`,
    // a resolved alias, an official handle with no `forFeature`). Two contracts
    // sharing one fact kind must still be separately assertable.
    l.grammar = 'adr-102';
    byKey.set(key(l), l);
  }
  const merged = [...linkages];
  for (const s of strict) {
    const hit = byKey.get(key(s));
    if (hit) {
      hit.strict = s.strict;
      continue;
    }
    merged.push({ ...s, grammar: 'adr-106' });
  }
  merged.sort((a, b) =>
    a.entrypoint < b.entrypoint
      ? -1
      : a.entrypoint > b.entrypoint
        ? 1
        : a.provider < b.provider
          ? -1
          : a.provider > b.provider
            ? 1
            : a.op < b.op
              ? -1
              : a.op > b.op
                ? 1
                : cmpNullable(a.entity, b.entity),
  );
  return merged;
}

const cmpNullable = (a, b) => {
  const x = a ?? '';
  const y = b ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
};
