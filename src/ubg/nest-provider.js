// ubg/nest-provider.js — Nest static direct provider V1.
//
// A Nest route reaches an ORM call through a chain the container assembles at
// RUNTIME. The Core already follows that chain by reading the controller's
// constructor parameter TYPE — which is sound for over-approximating effects
// (Direction 1: finding more is the safe direction) and is NOT a proof about
// which class is behind the dependency. `useClass`, `useValue`, a factory, a
// token or a subclass override all put a different body there, and none of them
// is visible in a type annotation.
//
// This module proves the chain a different way, or refuses. Everything it states
// rests on LITERALS the source itself contains:
//
//   1. a literal `@Module` (with `Module` resolving to `@nestjs/common`)
//      declaring literal `controllers: [C]` and `providers: [S]`
//   2. both symbols reached through EXACT RELATIVE imports
//   3. ordinary typed constructor injection in the controller — no `@Inject`
//   4. `TypeOrmModule`/`SequelizeModule` imported from `@nestjs/typeorm` /
//      `@nestjs/sequelize`, with a literal `forFeature([Entity])`
//   5. `InjectRepository`/`InjectModel` imported from the SAME official package,
//      and the service's entity resolving to the SAME FILE as the module's
//   6. the service method calling an enumerated ORM operation directly on that
//      injected receiver
//
// NAMES ARE NEVER ENOUGH, and that is the whole point of the provenance checks: a
// local file exporting its own `InjectRepository` and its own `TypeOrmModule` is
// a shape that already exists in the wild, and a rule that matched the name would
// credit it. Every provenance here is resolved through the Core's EXISTING import
// map — there is no second resolver, and no second graph.
//
// IT IS EVIDENCE, NEVER A PROPERTY. It creates no effect node, removes none,
// changes no finding, credits no guard, no ownership and no `PROVEN`. Where the
// compiled graph already has an effect for the operation, the fact carries its
// id; where it does not, the fact carries `effect: null` — which is the honest
// measurement of "the route and the ORM call are both proven and the effect node
// does not exist", never a claim that nothing happens (ADR-102).
import path from 'node:path';
import { classInModule, parseModule } from './extract.js';
import { entrypointId } from './schema.js';
import { factId, makeFact, record } from './kernel/facts.js';
import { providerFlows } from './nest-provider-tapp.js';

// The two official packages, and the exact symbols each contributes.
const OFFICIAL = new Map([
  [
    '@nestjs/typeorm',
    { factory: 'TypeOrmModule', inject: 'InjectRepository', orm: 'typeorm' },
  ],
  [
    '@nestjs/sequelize',
    { factory: 'SequelizeModule', inject: 'InjectModel', orm: 'sequelize' },
  ],
]);

// The vocabulary the Lab actually MEASURED (CONTRACT.md). Extending it needs new
// evidence and its own hard negatives — a longer list is a wider claim.
const V1_OPS = new Set([
  'create',
  'update',
  'updateMany',
  'destroy',
  'delete',
  'findAll',
  'findOne',
  'findByPk',
  'save',
  'remove',
  'softRemove',
  'softDelete',
  'findAndCount',
]);

const NEST_COMMON = '@nestjs/common';
const MAX_MEMBERS = 200;

// The raw specifier that binds `local` in this module, or null. The Core's import
// map stores the RESOLVED file (and nothing for an external package), so the
// specifier is read from the AST the parser already produced — provenance is a
// question about what was written, not about what it resolved to on disk.
export function importSourceOf(mod, local) {
  for (const node of mod?.ast?.program?.body ?? []) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers ?? []) {
      // V1 accepts a NAMED import only. A default or namespace import binds a
      // whole module object, and `X.forFeature` on it is a member of something
      // this grammar has not established.
      if (spec.type !== 'ImportSpecifier' || spec.local?.name !== local) continue;
      if (spec.imported?.type !== 'Identifier') return null;
      return { source: node.source.value, imported: spec.imported.name };
    }
  }
  return null;
}

// Is `local` the named export `expected` of one of the official packages?
const officialBinding = (mod, local, expected) => {
  const hit = importSourceOf(mod, local);
  if (!hit || hit.imported !== expected) return null;
  const pkg = OFFICIAL.get(hit.source);
  return pkg && pkg[expected === pkg.factory ? 'factory' : 'inject'] === expected
    ? { pkg: hit.source, ...pkg }
    : null;
};

// A symbol reached through an EXACT RELATIVE import, resolved by the Core's own
// import map. A bare specifier is a package; an alias or a barrel is a binding
// this grammar has not proved, and both are left to the caller to declare.
function relativeTarget(mod, local) {
  const hit = importSourceOf(mod, local);
  if (!hit || !hit.source.startsWith('.')) return null;
  const file = mod.imports?.get(local);
  return file ? { file, imported: hit.imported, source: hit.source } : null;
}

export const decoratorCall = (dec) =>
  dec?.expression?.type === 'CallExpression' ? dec.expression : null;

// The object literal of `@Module({...})`, with `Module` itself proved to come
// from `@nestjs/common`.
export function moduleObjectOf(cls, mod) {
  for (const dec of cls.decorators ?? []) {
    const call = decoratorCall(dec);
    if (call?.callee?.type !== 'Identifier' || call.callee.name !== 'Module') continue;
    const src = importSourceOf(mod, 'Module');
    if (src?.source !== NEST_COMMON || src.imported !== 'Module') return null;
    const arg = call.arguments[0];
    return arg?.type === 'ObjectExpression' ? arg : null;
  }
  return null;
}

export const propertyOf = (obj, name) =>
  (obj?.properties ?? []).find(
    (p) =>
      p.type === 'ObjectProperty' &&
      !p.computed &&
      p.key?.type === 'Identifier' &&
      p.key.name === name,
  ) ?? null;

// `[A, B]` → ['A','B']. `null` for anything else — a `{ provide, useClass }`
// entry, a spread, a call, a conditional. The refusal is deliberately whole-list:
// one token provider means the module's binding set is a container decision, and
// picking the entries that "look plain" out of it is exactly the guess this
// module exists to avoid.
export function literalClassList(obj, key) {
  const prop = propertyOf(obj, key);
  if (!prop || prop.value?.type !== 'ArrayExpression') return null;
  const out = [];
  for (const el of prop.value.elements) {
    if (el?.type !== 'Identifier') return null;
    out.push(el.name);
  }
  return out;
}

// `imports: [TypeOrmModule.forFeature([User])]` → { orm, pkg, entities }.
function featureRegistrationOf(obj, mod) {
  const prop = propertyOf(obj, 'imports');
  if (!prop || prop.value?.type !== 'ArrayExpression') return null;
  for (const el of prop.value.elements) {
    if (
      el?.type !== 'CallExpression' ||
      el.callee?.type !== 'MemberExpression' ||
      el.callee.computed ||
      el.callee.object?.type !== 'Identifier' ||
      el.callee.property?.type !== 'Identifier' ||
      el.callee.property.name !== 'forFeature'
    )
      continue;
    const official = officialBinding(mod, el.callee.object.name, el.callee.object.name);
    if (!official) continue;
    const list = el.arguments[0];
    if (list?.type !== 'ArrayExpression') return null; // a non-literal registration
    const entities = [];
    for (const e of list.elements) {
      if (e?.type !== 'Identifier') return null;
      entities.push(e.name);
    }
    return { ...official, entities };
  }
  return null;
}

export const constructorOf = (cls) =>
  cls?.body?.body?.find((m) => m.type === 'ClassMethod' && m.kind === 'constructor') ??
  null;

export const paramIdentifier = (p) => {
  const inner = p?.type === 'TSParameterProperty' ? p.parameter : p;
  return inner?.type === 'Identifier' ? inner : null;
};

export const typeNameOf = (id) => {
  const t = id?.typeAnnotation?.typeAnnotation;
  return t?.type === 'TSTypeReference' && t.typeName?.type === 'Identifier'
    ? t.typeName.name
    : null;
};

// field → provider class, for ORDINARY typed injection only. A parameter carrying
// ANY decorator is refused: `@Inject(TOKEN)` hands the choice to the container,
// and this grammar does not read tokens.
function directInjections(cls, providers) {
  const out = new Map();
  const decorated = [];
  for (const p of constructorOf(cls)?.params ?? []) {
    const id = paramIdentifier(p);
    const type = typeNameOf(id);
    if (!id || !type || !providers.includes(type)) continue;
    // The parameter names a class this module declares as a provider — so this
    // WOULD have been a linkage. A decorator on it hands the choice back to the
    // container, and skipping it silently would make "refused" and "no such
    // dependency" the same answer downstream (hard rule 9).
    if ((p.decorators ?? []).length || (id.decorators ?? []).length) {
      decorated.push(`${cls.id?.name ?? '<controller>'}.${id.name}`);
      continue;
    }
    out.set(id.name, type);
  }
  return { injected: out, decorated };
}

// field → { entity, decorator } for `@InjectRepository(E)` / `@InjectModel(E)`,
// where the decorator is proved to come from the official package.
function injectedReceivers(cls, mod, official) {
  const out = new Map();
  for (const p of constructorOf(cls)?.params ?? []) {
    const id = paramIdentifier(p);
    if (!id) continue;
    for (const dec of [...(p.decorators ?? []), ...(id.decorators ?? [])]) {
      const call = decoratorCall(dec);
      if (call?.callee?.type !== 'Identifier') continue;
      if (call.callee.name !== official.inject) continue;
      // the decorator's own provenance — a local lookalike stops here
      const bound = importSourceOf(mod, call.callee.name);
      if (bound?.source !== official.pkg || bound.imported !== official.inject) continue;
      const arg = call.arguments[0];
      if (arg?.type !== 'Identifier') continue;
      out.set(id.name, arg.name);
    }
  }
  return out;
}

// every `this.<field>.<member>(...)` in a method body, bounded
function memberCallsOn(fn, fields) {
  const out = [];
  const walk = (n, budget) => {
    if (!n || typeof n !== 'object' || out.length >= MAX_MEMBERS || budget.n <= 0) return;
    budget.n -= 1;
    if (Array.isArray(n)) {
      for (const c of n) walk(c, budget);
      return;
    }
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'MemberExpression' &&
      !n.callee.computed &&
      n.callee.property?.type === 'Identifier' &&
      n.callee.object?.type === 'MemberExpression' &&
      !n.callee.object.computed &&
      n.callee.object.object?.type === 'ThisExpression' &&
      n.callee.object.property?.type === 'Identifier' &&
      fields.has(n.callee.object.property.name)
    )
      out.push({
        field: n.callee.object.property.name,
        member: n.callee.property.name,
        line: n.loc?.start.line ?? 0,
        // The call NODE, so the TAPP pass can read argument positions without a
        // second walk of the same grammar. Two walks over one shape drift, and the
        // one that drifted is the one nobody re-reads (the reason `origins` rides
        // `collectReqDerived`'s walk rather than its own).
        node: n,
      });
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const c = n[k];
      if (c && typeof c === 'object') walk(c, budget);
    }
  };
  walk(fn?.body, { n: 4000 });
  return out;
}

export const methodsOf = (cls) =>
  (cls?.body?.body ?? []).filter(
    (m) => m.type === 'ClassMethod' && m.key?.type === 'Identifier',
  );

// Every literal `@Module` class in a file, with the module object it declares.
// Shared by the linkage walk and the uniqueness pre-pass so the two cannot come to
// different conclusions about what a module IS.
export function* moduleClassesOf(mod) {
  for (const node of mod?.ast?.program?.body ?? []) {
    const cls =
      node.type === 'ClassDeclaration'
        ? node
        : node.type === 'ExportNamedDeclaration' &&
            node.declaration?.type === 'ClassDeclaration'
          ? node.declaration
          : null;
    if (!cls) continue;
    const obj = moduleObjectOf(cls, mod);
    if (obj) yield { cls, obj };
  }
}

// How many literal modules declare each controller/provider CLASS FILE. The TAPP
// contract asks for a UNIQUE module, not merely for one: two modules naming the
// same controller means the source states two bindings and the container picks
// between them, so no single chain is proved. Keyed by resolved FILE and name —
// two `UserService` classes in two files are two providers, and a module that
// registered one says nothing about the other (the same rule ADR-102 applies to
// entities).
//
// It only ever REFUSES: a count above one silences a TAPP flow and touches no
// linkage, no effect and no verdict.
export function moduleBindingCounts(moduleFiles) {
  const counts = new Map();
  for (const file of moduleFiles) {
    const mod = parseModule(file);
    if (!mod || mod.error) continue;
    for (const { obj } of moduleClassesOf(mod))
      for (const key of ['controllers', 'providers'])
        for (const name of literalClassList(obj, key) ?? []) {
          const target = relativeTarget(mod, name);
          if (!target) continue;
          const id = `${target.file}#${name}`;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The BINDING half of the linkage, route-independent — ADR-105.
//
// `nestDirectProviderLinkages` answers a question about a ROUTE, and it needs the
// route table to do it. The resolver needs the same proof EARLIER: when it is
// about to walk `this.<field>.<method>()` out of a controller and into a provider
// body, it has to know whether the source itself settles which class is on the
// other side. A TypeScript type does not settle it — `useClass`, `useValue`, a
// factory, a token or a subclass override all put a different body there.
//
// So the module-literal proof is factored out and asked WITHOUT routes. It is the
// SAME grammar, in the same file, reading the same literals: one literal `@Module`
// (with `Module` from `@nestjs/common`), literal `controllers` and `providers`
// lists, an official `forFeature` registration, exact relative imports, ordinary
// undecorated typed injection, and a class that the target file DECLARES rather
// than re-exports.
//
// → Map<`${controllerFile}#${ControllerClass}`, Map<field, { file, name }>>
//
// It only ever grants; everything it cannot prove is simply absent, and an absent
// entry means the resolver seeds nothing and behaves exactly as it does today.
// That is what makes the blast radius checkable: on an application where this map
// is EMPTY, the compiled graph must be byte-identical.
export function provedProviderBindings({ moduleFiles }) {
  const counts = moduleBindingCounts(moduleFiles);
  const unique = (file, name) => (counts.get(`${file}#${name}`) ?? 0) === 1;
  const out = new Map();

  for (const file of moduleFiles) {
    const mod = parseModule(file);
    if (!mod || mod.error) continue;

    for (const { obj } of moduleClassesOf(mod)) {
      if (!propertyOf(obj, 'controllers')) continue;
      const controllers = literalClassList(obj, 'controllers');
      const providers = literalClassList(obj, 'providers');
      // A non-literal entry anywhere in either list means the container decides
      // the whole binding set. Whole-list refusal, exactly as ADR-102 reasoned:
      // picking the entries that "look plain" out of a list containing a token is
      // the guess this grammar exists to avoid.
      if (!controllers?.length || !providers) continue;
      // Deliberately the SAME module conditions ADR-102 accepts, `forFeature`
      // included. The binding alone would be a wider gate — and a wider gate is a
      // wider claim, which owes its own measurement. Keeping them identical is
      // what makes "seed only where a linkage is already proved" literally true.
      if (!featureRegistrationOf(obj, mod)) continue;

      for (const ctrlName of controllers) {
        const ctrlTarget = relativeTarget(mod, ctrlName);
        if (!ctrlTarget || !unique(ctrlTarget.file, ctrlName)) continue;
        const ctrlMod = parseModule(ctrlTarget.file);
        const ctrlCls = classInModule(ctrlMod, ctrlName);
        if (!ctrlMod || ctrlMod.error || !ctrlCls) continue;

        const fields = new Map();
        // `directInjections` already refuses a parameter carrying ANY decorator —
        // `@Inject(TOKEN)` hands the choice back to the container.
        for (const [field, svcName] of directInjections(ctrlCls, providers).injected) {
          const svcTarget = relativeTarget(mod, svcName);
          if (!svcTarget || !unique(svcTarget.file, svcName)) continue;
          const svcMod = parseModule(svcTarget.file);
          // The target file must DECLARE the class. A barrel that re-exports it is
          // a relative import that resolves, and it is not a proof of which
          // declaration the name reaches.
          if (!svcMod || svcMod.error || !classInModule(svcMod, svcName)) continue;
          fields.set(field, { file: svcTarget.file, name: svcName });
        }
        if (fields.size) out.set(`${ctrlTarget.file}#${ctrlName}`, fields);
      }
    }
  }
  return out;
}

function declare(ledger, file, line, symbol, reason, detail) {
  if (!ledger) return;
  record(
    ledger,
    makeFact(
      'UnknownBoundary',
      factId('UnknownBoundary', file, line, `${reason}:${symbol}`),
      { symbol, detail, owner: null },
      { file, line, symbol, contract: 'nest/provider', uncertainty: reason },
    ),
  );
}

// → linkage records. `routes` is the lowering's OWN route list, so a linkage can
// only ever name a route the graph already has: this pass may add evidence about
// the route table, never a route to it.
export function nestDirectProviderLinkages({ cwd, moduleFiles, routes, ledger = null }) {
  const links = [];
  const routeAt = new Map();
  for (const r of routes) routeAt.set(`${r.sourceFile}#${r.sourceLine}`, r);
  // Read once, before any linkage: uniqueness is a property of the whole module
  // set, and a check that only saw the modules visited so far would answer
  // differently depending on file order.
  const bindingCounts = moduleBindingCounts(moduleFiles);

  for (const file of moduleFiles) {
    const mod = parseModule(file);
    if (!mod || mod.error) continue;
    const rel = path.relative(cwd, file).split(path.sep).join('/');

    for (const node of mod.ast.program.body) {
      const cls =
        node.type === 'ClassDeclaration'
          ? node
          : node.type === 'ExportNamedDeclaration' &&
              node.declaration?.type === 'ClassDeclaration'
            ? node.declaration
            : null;
      if (!cls) continue;
      const obj = moduleObjectOf(cls, mod);
      if (!obj) continue;
      const line = cls.loc?.start.line ?? 0;
      const name = cls.id?.name ?? '<module>';

      // A module that declares no controllers has no route to link, so there is
      // nothing to refuse either. Declaring it would fill the ledger with the
      // root module of every application and make the real refusals harder to
      // find — over-declaring is safe for soundness and corrosive for a ledger
      // someone has to read.
      if (!propertyOf(obj, 'controllers')) continue;
      const controllers = literalClassList(obj, 'controllers');
      const providers = literalClassList(obj, 'providers');
      if (!controllers?.length || !providers) {
        // a token/factory/value provider, a spread, or a computed list
        declare(
          ledger,
          rel,
          line,
          name,
          'unresolved-provider',
          'the module binds controllers or providers through something other than a literal class list — the container chooses the class, the source does not',
        );
        continue;
      }
      const feature = featureRegistrationOf(obj, mod);
      if (!feature) {
        declare(
          ledger,
          rel,
          line,
          name,
          'unresolved-provider',
          'no literal forFeature([...]) from @nestjs/typeorm or @nestjs/sequelize — the ORM registration of this module is not statically established',
        );
        continue;
      }
      // the entity FILES this module registers, resolved through the existing map
      const registered = new Map();
      for (const e of feature.entities) {
        const target = relativeTarget(mod, e);
        if (target) registered.set(e, target.file);
      }

      for (const ctrlName of controllers) {
        const ctrlTarget = relativeTarget(mod, ctrlName);
        if (!ctrlTarget) {
          declare(
            ledger,
            rel,
            line,
            ctrlName,
            'unresolved-module',
            'the controller is not reached through an exact relative import',
          );
          continue;
        }
        const ctrlMod = parseModule(ctrlTarget.file);
        const ctrlCls = classInModule(ctrlMod, ctrlName);
        if (!ctrlMod || ctrlMod.error || !ctrlCls) continue;
        const ctrlRel = path.relative(cwd, ctrlTarget.file).split(path.sep).join('/');
        const { injected, decorated } = directInjections(ctrlCls, providers);
        for (const symbol of decorated)
          declare(
            ledger,
            ctrlRel,
            ctrlCls.loc?.start.line ?? 0,
            symbol,
            'unresolved-provider',
            'the controller parameter carries a decorator, so which class arrives is a container decision — the module literal does not settle it',
          );

        for (const method of methodsOf(ctrlCls)) {
          const route = routeAt.get(`${ctrlRel}#${method.loc?.start.line ?? 0}`);
          if (!route) continue;
          for (const call of memberCallsOn(method, injected)) {
            const svcName = injected.get(call.field);
            const svcTarget = relativeTarget(mod, svcName);
            if (!svcTarget) {
              declare(
                ledger,
                rel,
                line,
                svcName,
                'unresolved-module',
                'the provider is not reached through an exact relative import',
              );
              continue;
            }
            const svcMod = parseModule(svcTarget.file);
            const svcCls = classInModule(svcMod, svcName);
            if (!svcMod || svcMod.error || !svcCls) continue;
            const svcRel = path.relative(cwd, svcTarget.file).split(path.sep).join('/');
            const receivers = injectedReceivers(svcCls, svcMod, feature);
            if (!receivers.size) {
              declare(
                ledger,
                svcRel,
                svcCls.loc?.start.line ?? 0,
                svcName,
                'unresolved-provider',
                `no ${feature.inject} from ${feature.pkg} on ${svcName} — the injected receiver is not established by this package`,
              );
              continue;
            }
            const svcMethod = methodsOf(svcCls).find((m) => m.key.name === call.member);
            if (!svcMethod) {
              declare(
                ledger,
                svcRel,
                svcCls.loc?.start.line ?? 0,
                `${svcName}.${call.member}`,
                'unresolved-export',
                'the controller calls a member the provider class does not declare',
              );
              continue;
            }
            for (const orm of memberCallsOn(svcMethod, new Set(receivers.keys()))) {
              if (!V1_OPS.has(orm.member)) {
                declare(
                  ledger,
                  svcRel,
                  orm.line,
                  `${svcName}.${call.member}.${orm.member}`,
                  'unresolved-export',
                  `${orm.member} is outside the measured V1 operation vocabulary`,
                );
                continue;
              }
              const entity = receivers.get(orm.field);
              const svcEntityFile = relativeTarget(svcMod, entity)?.file ?? null;
              const modEntityFile = registered.get(entity) ?? null;
              // SAME FILE, not the same NAME: two `User` classes in two files are
              // two entities, and the module that registered one says nothing
              // about the other.
              if (!svcEntityFile || !modEntityFile || svcEntityFile !== modEntityFile) {
                declare(
                  ledger,
                  svcRel,
                  orm.line,
                  `${svcName}.${entity}`,
                  'unresolved-provider',
                  `the entity ${entity} the service injects is not the one this module registered with forFeature`,
                );
                continue;
              }
              links.push({
                entrypoint: entrypointId(route.method, route.path),
                controller: `${ctrlName}.${method.key.name}`,
                controllerFile: ctrlRel,
                provider: `${svcName}.${call.member}`,
                providerFile: svcRel,
                orm: feature.orm,
                pkg: feature.pkg,
                op: orm.member,
                entity,
                entityFile: path.relative(cwd, svcEntityFile).split(path.sep).join('/'),
                line: orm.line,
                // ADR-104 — the provenance ON the proved chain. Computed HERE, at
                // the one point where all eight contract conditions already hold,
                // so the flow can never be stated over a chain the module literal
                // did not settle. It adds one claim (which value, at which
                // position) and no second walk of the module grammar.
                flows: providerFlows({
                  controllerMethod: method,
                  controllerModule: ctrlMod,
                  serviceCall: call.node,
                  serviceMethod: svcMethod,
                  serviceName: svcName,
                  serviceMember: call.member,
                  ormCall: orm.node,
                  orm: feature.orm,
                  op: orm.member,
                  entity,
                  ambiguousModule:
                    (bindingCounts.get(`${ctrlTarget.file}#${ctrlName}`) ?? 0) > 1 ||
                    (bindingCounts.get(`${svcTarget.file}#${svcName}`) ?? 0) > 1,
                }),
              });
            }
          }
        }
      }
    }
  }
  links.sort((a, b) =>
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
                : 0,
  );
  return links;
}
