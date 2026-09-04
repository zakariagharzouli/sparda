// ubg/nest-provider-tapp.js — provenance across the Nest provider chain.
//
//   @Post() create(@Body() dto)  →  this.userService.create(dto)
//                                →  create(dto)  →  this.userRepository.save(dto)
//
// ADR-102 proved that CHAIN from literals: a literal `@Module` naming the
// controller and the provider, both reached by exact relative imports, an
// `@InjectRepository` whose provenance is `@nestjs/typeorm` itself, and a matching
// `TypeOrmModule.forFeature([Entity])`. What it could not say is WHICH REQUEST
// VALUE travels it. MEASURED on `vndevteam/nestjs-boilerplate` at `cb6bea3`: five
// linkages, five DbEffectOccurrences, and every one of them `dataOrigins: []`.
// The DB effect was seen; the provenance stopped at the class boundary.
//
// This module states that provenance, or refuses out loud. It adds no walk of its
// own over the module grammar: it runs at the exact point in `nest-provider.js`
// where all eight contract conditions are already established, and asks only the
// two questions that remain — which parameter carries the request surface, and
// does that value reach the ORM argument by position.
//
// IT IS DIAGNOSTIC-ONLY, and that is not a disclaimer, it is the design. The
// output is `DataFlowPath` — the fact kind ADR-100 created as evidence that
// "cannot credit a guard, remove an effect or move a verdict". Nothing here
// touches taint, `filterOrigins`, `dataOrigins`, a finding or a verdict; a route
// cannot become PROVEN because a path was stated, and `unknown-access-path` stays
// out of `BOUNDARY_AFFECTS` so a path that was NOT stated degrades nothing either.
//
// A TYPE IS NEVER THE PROOF. The Core's existing DI hop reads the constructor
// parameter's TypeScript type, which is sound for over-approximating effects and
// says nothing about which class the container binds. Every claim below rests on
// the module literal ADR-102 read, and on argument POSITIONS in source — never on
// a type, a decorator name, a parameter name, or a runtime container.
import { walkAst } from './resolve.js';

// The three request surfaces this grammar reads, and the origin each denotes.
// `@Headers`, `@Req`, `@Session`, `@UploadedFile` and every custom decorator are
// deliberately absent: TAPP-1's source grammar is body/params/query, and widening
// it here would make two layers disagree about what a source IS.
export const HTTP_SURFACES = Object.freeze(
  new Map([
    ['Body', 'body'],
    ['Param', 'params'],
    ['Query', 'query'],
  ]),
);

const NEST_COMMON = '@nestjs/common';

// Which ROLE each argument position of an ORM operation plays. This table is the
// reason the pass can say `filter` rather than "somewhere in the call", and it is
// per-ORM because the two libraries DISAGREE:
//
//   TypeORM     repo.update(criteria, partialEntity)   → filter, data
//   Sequelize   Model.update(values, options)          → data, filter
//
// A single shared table would state the exact opposite of the truth on one of
// them. An operation or a position ABSENT here yields a declared boundary, never
// a guess: `remove(entity)`, `create(entity)` and `updateMany` are left out
// because their argument is neither cleanly a selector nor cleanly a payload, and
// a role assigned to look complete is a wrong claim, not a partial one.
export const ROLE_BY_OP = Object.freeze(
  new Map([
    [
      'typeorm',
      Object.freeze(
        new Map([
          ['save', ['data']],
          ['update', ['filter', 'data']],
          ['delete', ['filter']],
          ['softDelete', ['filter']],
          ['findOne', ['filter']],
          ['findAndCount', ['filter']],
        ]),
      ),
    ],
    [
      'sequelize',
      Object.freeze(
        new Map([
          ['create', ['data']],
          ['update', ['data', 'filter']],
          ['destroy', ['filter']],
          ['findAll', ['filter']],
          ['findOne', ['filter']],
          ['findByPk', ['filter']],
        ]),
      ),
    ],
  ]),
);

// Why a journey that provably exists could not be stated. Closed, so the ledger
// aggregates by cause rather than by prose — a cause nobody can count is a cause
// nobody fixes.
export const TAPP_REFUSALS = Object.freeze({
  AMBIGUOUS_MODULE:
    'more than one literal @Module declares this controller or provider — which binding is live is a container decision',
  INDIRECT_CALL:
    'the call is nested inside a callback, event handler or queue subscriber, not written directly in the method body',
  AMBIGUOUS_POSITIONS:
    'a spread argument, a rest parameter or a duplicate parameter name makes argument positions unreadable',
  REBOUND: 'the parameter carrying the value is reassigned before it is passed on',
  UNREADABLE_ARGUMENT:
    'the value reaches the call in a shape this grammar cannot place — a member of a member, a call, an array, a conditional or a spread',
  DUPLICATE_POSITION:
    'the same value is passed at more than one argument position, so no single journey describes it',
  NO_ROLE:
    'the argument position of this ORM operation has no measured role — the value lands somewhere this grammar will not name filter or data',
  NOT_PLACED:
    'the parameter provably arrives in the provider and this grammar cannot place it in the ORM call',
});

const MAX_DEST_DEPTH = 6;
const WALK_BUDGET = 4000;

const paramIdentifier = (p) => {
  const inner = p?.type === 'TSParameterProperty' ? p.parameter : p;
  return inner?.type === 'Identifier' ? inner : null;
};

const decoratorCall = (dec) =>
  dec?.expression?.type === 'CallExpression' ? dec.expression : null;

// The raw specifier that binds `local` in this module, by NAMED import only. A
// default or namespace import binds a whole module object, and `X.Body` on it is a
// member of something this grammar has not established.
function importSourceOf(mod, local) {
  for (const node of mod?.ast?.program?.body ?? []) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const spec of node.specifiers ?? []) {
      if (spec.type !== 'ImportSpecifier' || spec.local?.name !== local) continue;
      if (spec.imported?.type !== 'Identifier') return null;
      return { source: node.source.value, imported: spec.imported.name };
    }
  }
  return null;
}

// Is this node written DIRECTLY in the body of `fn` — not inside a nested
// function? The contract says the controller calls the service and the service
// calls the repository *directly*; a callback, an event handler, a queue
// subscriber or a `.then` changes WHEN the code runs and whether it runs at all,
// and a path stated through one would assert a journey the program may never take.
//
// ADR-102's linkage is deliberately looser here — an effect reached through a
// callback is still an effect, and over-approximating effects is the safe
// direction. A PATH is the opposite kind of claim, so it takes the stricter test.
export function writtenDirectlyIn(fn, target) {
  let found = false;
  const budget = { n: WALK_BUDGET };
  const walk = (n) => {
    if (found || !n || typeof n !== 'object' || budget.n <= 0) return;
    budget.n -= 1;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (n === target) {
      found = true;
      return;
    }
    if (
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression' ||
      n.type === 'FunctionDeclaration' ||
      n.type === 'ClassMethod'
    )
      return; // a nested body is a different moment
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const c = n[k];
      if (c && typeof c === 'object') walk(c);
    }
  };
  walk(fn?.body);
  return found;
}

// Is this parameter name written to, re-declared or shadowed anywhere in the body?
// Deliberately coarse, exactly as `resolve.js#paramRebound` is and for the same
// reason: one conservative refusal costs a declared boundary, while one missed
// rebinding states a path the program does not take.
export function rebound(fn, name) {
  let hit = false;
  walkAst(fn?.body, (node) => {
    if (hit) return;
    const written = node.left ?? node.argument;
    if (
      (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') &&
      written?.type === 'Identifier' &&
      written.name === name
    )
      hit = true;
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.id.name === name
    )
      hit = true;
    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      (node.params ?? []).some((p) => paramIdentifier(p)?.name === name)
    )
      hit = true;
  });
  return hit;
}

// → { origin, name, pipes } for `@Body() dto` / `@Param('id', ParseUUIDPipe) id`,
// or null. The decorator's PROVENANCE is resolved — a project-local `Body` is not
// Nest's, and matching the identifier would credit it (the same rule ADR-102
// applies to `InjectRepository`).
//
// A pipe is kept IN the path rather than treated as laundering: TAPP-1 already
// decided a normalizer does not remove provenance, and `ParseUUIDPipe` is that
// rule at the decorator position. A pipe written as anything but a plain class
// reference (`new ParseIntPipe({ … })`) is refused whole — its behaviour is
// configured by a value this grammar does not read.
export function surfaceOfParameter(param, mod) {
  const id = paramIdentifier(param);
  if (!id) return null;
  // A plain parameter IS its identifier, so the two lists are the same array; a
  // `TSParameterProperty` wraps a different node and can carry either. The Set is
  // what keeps `@Body() dto` from reading as two decorators and being refused as
  // ambiguous — it was, and the whole pass produced nothing on real source.
  const decorators = [
    ...new Set([...(param.decorators ?? []), ...(id.decorators ?? [])]),
  ];
  // EXACTLY one. `@Body() @SomethingElse() dto` is two claims about one value and
  // this grammar reads only the first kind; refusing is how it avoids picking.
  if (decorators.length !== 1) return null;
  const call = decoratorCall(decorators[0]);
  if (call?.callee?.type !== 'Identifier') return null;
  const origin = HTTP_SURFACES.get(call.callee.name);
  if (!origin) return null;
  const bound = importSourceOf(mod, call.callee.name);
  if (bound?.source !== NEST_COMMON || bound.imported !== call.callee.name) return null;
  const args = [...call.arguments];
  // `@Body()` and `@Body(ValidationPipe)` name the WHOLE surface; only a leading
  // string literal narrows it to one property.
  const name = args[0]?.type === 'StringLiteral' ? args.shift().value : null;
  const pipes = [];
  for (const a of args) {
    if (a?.type !== 'Identifier') return null;
    pipes.push(`${a.name}()`);
  }
  return { param: id.name, origin, name, pipes };
}

// Every position at which `name` is passed as a bare identifier, plus whether it
// appears ANYWHERE else in the argument list. The second half is what separates
// "this value does not travel here" (no fact) from "it travels in a shape this
// grammar cannot read" (a declared boundary) — hard rule 9 at this seam.
function positionsOf(args, name) {
  const bare = [];
  let elsewhere = false;
  args.forEach((arg, i) => {
    if (arg?.type === 'Identifier' && arg.name === name) {
      bare.push(i);
      return;
    }
    walkAst(arg, (node) => {
      if (node.type === 'Identifier' && node.name === name) elsewhere = true;
    });
  });
  return { bare, elsewhere };
}

// Positions are readable for the WHOLE call, or for none of it. ADR-101 settled
// that this refusal is call-wide rather than per-parameter, because a rule that
// binds "the positions before the spread" is one edit away from binding the ones
// after it.
//
// TWO checks, not four, and the two that were dropped are the point. A REST
// parameter and a DESTRUCTURED one are both refused by the second line — neither
// is a plain identifier — and a DUPLICATE parameter name cannot reach this
// function at all: everything it reads is a `ClassMethod`, a class body is always
// strict, and the parser rejects `m(a, a)` before any of this runs (verified, not
// assumed). Keeping guards no test can tell apart from their neighbour is the
// dead weight ADR-097 removed once already.
function positionsReadable(args, params) {
  if ((args ?? []).some((a) => a?.type === 'SpreadElement')) return false;
  return (params ?? []).every((p) => paramIdentifier(p) !== null);
}

// Where does `name` land inside one ORM argument? → { placed, unreadable }.
//
//   save(dto)                                → placed: [{ keys: [], member: null }]
//   save({ email: dto.email, at: dto.city }) → placed: two entries
//   save([dto])                              → unreadable
//
// EVERY placement, never the first one. A value that lands in two payload keys
// took two journeys, and a walk that returned the first would state one of them
// and silently drop the other — ADR-100 settled that a source with two
// destinations produces two paths rather than one that picks a winner.
function mentions(node, name) {
  let seen = false;
  walkAst(node, (n) => {
    if (n.type === 'Identifier' && n.name === name) seen = true;
  });
  return seen;
}

function placeInArgument(node, name, keys, depth, out) {
  if (!node) return false;
  if (depth > MAX_DEST_DEPTH) {
    if (mentions(node, name)) out.unreadable = true;
    return false;
  }
  if (node.type === 'Identifier') {
    if (node.name !== name) return false;
    out.placed.push({ keys, member: null });
    return true;
  }
  if (
    (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    node.object.name === name &&
    node.property?.type === 'Identifier'
  ) {
    out.placed.push({ keys, member: node.property.name });
    return true;
  }
  if (node.type === 'ObjectExpression') {
    let placedHere = false;
    let skipped = false;
    for (const prop of node.properties) {
      // a spread, a method or a computed key is not a static destination — and a
      // value UNDER one is not dropped, it is charged to `unreadable`
      const key =
        prop.type === 'ObjectProperty' && !prop.computed
          ? prop.key?.type === 'Identifier'
            ? prop.key.name
            : prop.key?.type === 'StringLiteral'
              ? prop.key.value
              : null
          : null;
      if (key == null) {
        if (mentions(prop, name)) skipped = true;
        continue;
      }
      if (placeInArgument(prop.value, name, [...keys, key], depth + 1, out))
        placedHere = true;
      else if (mentions(prop.value, name)) skipped = true;
    }
    if (skipped) out.unreadable = true;
    return placedHere;
  }
  // an array, a call, a conditional, a template: the value may well be in there
  // and no static destination exists for it
  if (mentions(node, name)) out.unreadable = true;
  return false;
}

const sourceSegment = (s) => (s.name ? `req.${s.origin}.${s.name}` : `req.${s.origin}`);

const refuse = (surface, reason) => ({
  state: 'unknown',
  role: null,
  source: { origin: surface.origin, name: surface.name },
  path: null,
  dest: null,
  reason,
});

// → flow records for ONE proved linkage. `[]` means no request surface travels
// this chain, which is an absence and not an admission: the controller method
// either declares no body/params/query parameter, or declares one that is never
// handed to the provider. An unreadable journey is a record with `state:'unknown'`.
//
// Every input here is already PROVED by `nest-provider.js`: the module literal,
// the relative imports, the official package, the entity file, the operation
// vocabulary. This function adds exactly one claim — which value, at which
// position — and refuses it whole wherever a position is not readable.
export function providerFlows({
  controllerMethod,
  controllerModule,
  serviceCall,
  serviceMethod,
  serviceName,
  serviceMember,
  ormCall,
  orm,
  op,
  entity,
  ambiguousModule = false,
}) {
  const surfaces = [];
  for (const p of controllerMethod?.params ?? []) {
    const s = surfaceOfParameter(p, controllerModule);
    if (s) surfaces.push(s);
  }
  if (!surfaces.length) return [];

  // Contract condition 4 is UNIQUENESS, not existence. Two literal modules
  // declaring the same controller mean the source states two bindings and the
  // container picks; every surface below then travels a chain nobody proved.
  if (ambiguousModule)
    return surfaces.map((s) => refuse(s, TAPP_REFUSALS.AMBIGUOUS_MODULE));
  // Contract conditions 2 and 5: DIRECTLY. `nest-provider.js` finds these calls
  // anywhere in the body, which is right for an effect and wrong for a path.
  if (
    !writtenDirectlyIn(controllerMethod, serviceCall) ||
    !writtenDirectlyIn(serviceMethod, ormCall)
  )
    return surfaces.map((s) => refuse(s, TAPP_REFUSALS.INDIRECT_CALL));

  const hop1Readable = positionsReadable(serviceCall.arguments, serviceMethod.params);
  const hop2Readable = positionsReadable(ormCall.arguments, []);
  const roles = ROLE_BY_OP.get(orm)?.get(op) ?? [];

  const out = [];
  for (const s of surfaces) {
    if (!hop1Readable || !hop2Readable) {
      out.push(refuse(s, TAPP_REFUSALS.AMBIGUOUS_POSITIONS));
      continue;
    }
    const { bare, elsewhere } = positionsOf(serviceCall.arguments, s.param);
    // Not handed to the provider at all: no journey exists through this chain, so
    // there is nothing to state and nothing to admit.
    if (!bare.length && !elsewhere) continue;
    if (!bare.length) {
      out.push(refuse(s, TAPP_REFUSALS.UNREADABLE_ARGUMENT));
      continue;
    }
    if (bare.length > 1) {
      out.push(refuse(s, TAPP_REFUSALS.DUPLICATE_POSITION));
      continue;
    }
    if (rebound(controllerMethod, s.param)) {
      out.push(refuse(s, TAPP_REFUSALS.REBOUND));
      continue;
    }
    const i = bare[0];
    const inner = paramIdentifier(serviceMethod.params[i]);
    if (!inner) {
      out.push(refuse(s, TAPP_REFUSALS.UNREADABLE_ARGUMENT));
      continue;
    }
    if (rebound(serviceMethod, inner.name)) {
      out.push(refuse(s, TAPP_REFUSALS.REBOUND));
      continue;
    }

    const hop = [
      sourceSegment(s),
      ...s.pipes,
      s.param,
      `${serviceName}.${serviceMember}(#${i})`,
      inner.name,
    ];
    const placed = [];
    let unreadable = false;
    let unroled = false;
    ormCall.arguments.forEach((arg, j) => {
      const at = { placed: [], unreadable: false };
      placeInArgument(arg, inner.name, [], 0, at);
      if (at.unreadable) unreadable = true;
      if (!at.placed.length) return;
      // The ROLE is a property of the POSITION, and the two ORMs disagree about
      // which position is which. A hit at a position the table does not cover is
      // refused rather than named: `remove(entity)` and TypeORM's `create(entity)`
      // take an argument that is neither cleanly a selector nor cleanly a payload.
      const role = roles[j] ?? null;
      if (!role) {
        unroled = true;
        return;
      }
      for (const hit of at.placed) {
        // The destination is the ROLE plus the static keys the value landed under
        // — `filter`, `data.email` — the same spelling TAPP-1 uses, so one reader
        // can compare a local path and an interprocedural one without a glossary.
        const dest = role + hit.keys.map((k) => `.${k}`).join('');
        placed.push({
          state: 'resolved',
          role,
          source: { origin: s.origin, name: s.name },
          dest,
          // `dto.email` is kept as its own step: the value that reaches the ORM is
          // a PROPERTY of the one the client sent, and a path that skipped it
          // would claim the whole surface arrived.
          path: [
            ...hop,
            ...(hit.member ? [`${inner.name}.${hit.member}`] : []),
            `${entity}.${op}(#${j})`,
            dest,
          ],
          reason: null,
        });
      }
    });
    // The same order TAPP-1 reconciles in: a source that landed SOMEWHERE is
    // described by where it landed. The admissions below are for a source that
    // landed nowhere this grammar can name — never a second entry beside a path
    // already stated, which would count one journey twice.
    if (placed.length) {
      out.push(...placed);
      continue;
    }
    out.push(
      refuse(
        s,
        unreadable
          ? TAPP_REFUSALS.UNREADABLE_ARGUMENT
          : unroled
            ? TAPP_REFUSALS.NO_ROLE
            : TAPP_REFUSALS.NOT_PLACED,
      ),
    );
  }
  return out;
}
