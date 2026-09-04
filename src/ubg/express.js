// ubg/express.js — Express codebase → route facts for the UBG translator.
// Richer than parser/express.js (which only needs tool signatures): here the
// FULL handler chain matters — every middleware between path and handler
// becomes a graph node, and identifier handlers are resolved to their function
// bodies (same file, then relative imports) so the microscope can scan them.
// Depth stays bounded like the v0 parser: entry file + mounted routers.
import fs from 'node:fs';
import path from 'node:path';
import traverseModule from '@babel/traverse';
import { parseModule, resolveRelImport, authDenyCall } from './extract.js';
import { createResolver, relOf, resolveInstanceMember } from './resolve.js';
import { captureChain, scopeBindings } from './kernel/bindings.js';
import { exportsExpressRouter, isRequiredModuleArg } from './express-router-value.js';
import { factId, makeFact, record } from './kernel/facts.js';

const traverse = traverseModule.default ?? traverseModule;
const EXPRESS_PACKAGE = 'express';

const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete']);

// `app.all(path, …)` answers EVERY verb — so it is not one route, it is one per
// verb. Expanding it (rather than inventing an `all` pseudo-verb) keeps every
// downstream organ exact: the OpenAPI emitter writes real operations, the mirror
// matches real requests, and the prover raises the guard obligation once per
// mutating verb the path actually exposes. Missing this made an unguarded
// `app.all('/admin/wipe')` invisible while the app read PROVEN (Z1).
const ALL_VERB_EXPANSION = [...HTTP];

// Express/Router members that are NOT route registrations. This allowlist is the
// counterpart of the structural invariant below: known plumbing stays quiet, and
// EVERYTHING ELSE called on an app/router object is reported as an UnknownHandler
// rather than dropped. Adding a name here is a deliberate claim that it cannot
// register a route — the only way to make the extractor silent again.
const NON_ROUTE_METHODS = new Set([
  // server / configuration surface
  'listen',
  'set',
  'enable',
  'disable',
  'enabled',
  'disabled',
  'engine',
  'render',
  'path',
  'init',
  'defaultConfiguration',
  'handle',
  'locals',
  'mountpath',
  // param preprocessors: they decorate an existing route, they never create one
  'param',
  // EventEmitter surface (an Express app IS one)
  'on',
  'once',
  'off',
  'emit',
  'addListener',
  'removeListener',
  'removeAllListeners',
  'setMaxListeners',
  'listeners',
  // promise/plumbing shapes that appear when an app is built asynchronously
  'then',
  'catch',
  'finally',
  'toString',
]);

// A minimal scan carrying ONLY the deny signal — attached to a middleware recognized as a known
// auth-library guard (ADR-069: `passport.authenticate()`, `expressjwt({…})`) whose body lives in
// node_modules and so can't be read in-repo. The catalog is a VERIFIED published fact, so the guard
// earns `verified` (→ can reach PROVEN), not merely `asserted`. No effects/reads enter the graph.
const AUTH_DENY_SCAN = {
  effects: [],
  returnShapes: [],
  calls: [],
  async: false,
  validatesInput: false,
  guardSignals: { deniesWithStatus: true },
};

// Mount-depth bound: entry (0) → mounted router (1) → its sub-router (2). Beyond it the
// walk stops — but never silently: the unexplored mount becomes a skipped-surface entry.
const MOUNT_DEPTH_MAX = 2;

// Wall-clock budget for one extraction. A pathological tree (generated mega-files,
// thousands of mounts) must degrade to an HONEST partial result — a high-risk
// skipped-surface entry that forbids PROVEN — never hang or crash the host tool.
const DEFAULT_BUDGET_MS = 120_000;

// → { routes, globalMiddlewares, helpers, skipped, unknownHandlers, scannedFiles }
export function extractExpress(cwd, entryFile, { budgetMs, kernel = null } = {}) {
  const routes = [];
  const globalMiddlewares = []; // app.use(fn) — applies to every LATER route (order-scoped)
  const helpers = []; // top-level functions of scanned files (dead-path candidates)
  const skipped = [];
  const unknownHandlers = []; // registrations SPARDA saw but cannot bind statically
  const scannedFiles = [];
  const visited = new Set();
  const mounts = [];
  const budget = budgetMs ?? Number(process.env.SPARDA_BUDGET_MS ?? DEFAULT_BUDGET_MS);
  const deadline = Date.now() + budget;
  let budgetSpent = false;
  // the interprocedural engine (ADR-054): follows service/model calls below each
  // handler — module members, instantiated classes, this./super. hops — bounded,
  // memoized per extract, appending discoveries into scannedFiles/helpers.
  const resolver = createResolver({ cwd, scannedFiles, helpers, kernel });

  scanFile(path.resolve(cwd, entryFile), '', 0, null);
  // growing queue, NOT a snapshot: a mounted router file can itself mount
  // sub-routers (app.use('/v1', routes) → router.use('/auth', authRoute)) —
  // the real-world boilerplate pattern. Depth still bounded by scanFile.
  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i];
    if (overBudget()) break;
    if (m.file && fs.existsSync(m.file))
      scanFile(m.file, m.prefix, m.depth ?? 1, m.order);
    else if (!m.file)
      skipped.push({
        reason: `router "${m.ident}" mounted at ${m.prefix} — source file not resolved`,
        file: m.fromFile,
      });
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return {
    routes,
    globalMiddlewares,
    helpers,
    skipped,
    unknownHandlers,
    scannedFiles,
  };

  // Exhausting the time budget is a MEASUREMENT FAILURE, not a pass: it surfaces exactly
  // once, at critical risk, so the verdict is forced off PROVEN (blindHigh) — the tool
  // degrades to an honest partial answer instead of hanging or lying by omission.
  function overBudget() {
    if (budgetSpent) return true;
    if (Date.now() <= deadline) return false;
    budgetSpent = true;
    skipped.push({
      reason: `analysis time budget (${budget} ms) exhausted — the remaining surface is unscanned; the verdict cannot claim PROVEN`,
      file: entryFile,
      risk: 'critical',
    });
    return true;
  }

  // baseOrder: the declaration order of the mount that brought this file in — a route in
  // a mounted router takes effect at the MOUNT's position in the entry stream, so the
  // sequential scope of a global middleware survives nesting at every depth.
  function scanFile(
    absFile,
    prefix,
    depth,
    baseOrder,
    bindings = null,
    inheritedConditional = false,
  ) {
    const key = [absFile, prefix, setupBindingKey(bindings)].join('::');
    if (visited.has(key) || overBudget()) return;
    if (depth > MOUNT_DEPTH_MAX) {
      // resource limits never abandon silently: the unexplored surface is declared
      skipped.push({
        reason: `mount depth limit (${MOUNT_DEPTH_MAX}) reached — router mounted at ${prefix || '/'} (${rel(absFile)}) left unscanned`,
        file: rel(absFile),
        risk: 'high',
      });
      return;
    }
    visited.add(key);

    const mod = parseModule(absFile);
    const relFile = rel(absFile);
    if (mod.error) {
      skipped.push({ reason: `${mod.error} in ${relFile}`, file: relFile });
      return;
    }
    scannedFiles.push(relFile);

    // every top-level function is a potential dead-path candidate
    for (const [name, f] of mod.functions) {
      helpers.push({
        name,
        sourceFile: relFile,
        sourceLine: f.line,
        fn: f.node,
      });
    }

    // Flatten setup-function bodies into the statement stream. The overwhelmingly
    // common production pattern builds the whole app inside a function —
    // `export default async function createApp() { const app = express(); …;
    // app.use('/x', xRouter); return app; }` (directus, and most real apps) — so the
    // `express()` var and every mount live one level down, invisible to a top-level-only
    // walk. We descend into function declarations, default-exported functions, top-level
    // `const f = () => {…}`, and their control-flow blocks — but NOT into function
    // *arguments* (route handlers), so handler bodies are never mistaken for setup.
    // An interprocedurally-bound setup module is scanned through the one exported
    // function that received the Express object. This is the semantic/data-flow
    // boundary: other local functions that merely happen to name a parameter "app"
    // must never become routes.
    const flat = bindings?.entrypoint
      ? flattenSetup(bindings.entrypoint.body?.body ?? [])
      : flattenSetup(mod.ast.program.body);
    const statements = flat.statements;
    if (flat.limit)
      skipped.push({
        reason: `setup scan truncated in ${relFile} — ${flat.limit}; the surface beyond it is unscanned`,
        file: relFile,
        risk: 'high',
      });

    // Route credit follows Babel's lexical binding identity all the way back to
    // the official `express` package. `flattenSetup` deliberately combines nested
    // setup scopes in one statement stream, so a Set<string> here lets a local
    // `const express = fake` or `const app = fake()` counterfeit the real binding.
    const expressObjects = collectExpressObjects(mod.ast, bindings);
    const instanceVars = collectInstanceVars(statements, mod);
    const callableAliases = collectCallableAliases(statements);
    const routeArrays = collectRouteArrays(statements);

    walkStatements(statements);
    bindCallbackSetups(statements);

    // A production app often defers its route table until an infrastructure callback
    // has supplied a dependency: `MongoClient.connect(uri, (err, db) => routes(app,
    // db))`. The registration is still statically present and the app/router identity
    // is lexical, but flattenSetup deliberately does not descend into *arguments* so it
    // cannot confuse a route handler with setup. Re-open only non-Express callback
    // bodies, and only for a strict semantic factory binding. The callback is marked
    // conditional below: if its scheduling cannot be proven, routes are modelled but
    // cannot buy a clean verdict.
    function bindCallbackSetups(body) {
      for (const stmt of body) {
        const expr =
          stmt.type === 'ExpressionStatement' && isCall(stmt.expression)
            ? stmt.expression
            : null;
        if (!expr) continue;
        const callee = expr.callee;
        const isExpressRegistration =
          isMember(callee) &&
          callee.object?.type === 'Identifier' &&
          (expressObjects.isApp(callee.object) || expressObjects.isRouter(callee.object));
        // Handler callbacks are intentionally opaque at this boundary. Descending into
        // one would treat a route registered during request handling as boot setup.
        if (isExpressRegistration) continue;

        for (const arg of expr.arguments) {
          if (
            arg?.type !== 'ArrowFunctionExpression' &&
            arg?.type !== 'FunctionExpression'
          )
            continue;
          const nested = flattenSetup(arg.body?.body ?? []);
          if (nested.limit)
            skipped.push({
              reason: `callback setup scan truncated in ${relFile} — ${nested.limit}`,
              file: relFile,
              line: arg.loc?.start.line,
              risk: 'high',
            });
          for (const nestedStmt of nested.statements) {
            const nestedExpr =
              nestedStmt.type === 'ExpressionStatement' && isCall(nestedStmt.expression)
                ? nestedStmt.expression
                : null;
            if (!nestedExpr) continue;
            const semanticSetup = setupModuleBinding(
              nestedExpr,
              expressObjects,
              mod,
              absFile,
            );
            if (!semanticSetup) continue;
            if (semanticSetup.unresolved) {
              unknownRegistration(
                'callback-module-setup-unresolvable',
                semanticSetup.target,
                nestedExpr,
              );
              continue;
            }
            scanFile(
              semanticSetup.file,
              prefix,
              depth + 1,
              flat.info.get(stmt)?.order ?? baseOrder,
              semanticSetup.bindings,
              true,
            );
          }
        }
      }
    }

    // A registration SPARDA saw but cannot bind statically (computed verb, Reflect.apply,
    // .apply/.call indirection). It must DEGRADE certainty, never vanish: an UnknownHandler
    // object plus a high-risk skipped-surface entry — the verdict can no longer claim PROVEN.
    function unknownRegistration(via, varName, node) {
      const line = node.loc?.start.line;
      unknownHandlers.push({
        kind: 'UnknownHandler',
        via,
        target: varName,
        file: relFile,
        ...(line ? { line } : {}),
      });
      skipped.push({
        reason: `dynamic registration on "${varName}" (${via}) — a route/middleware SPARDA cannot bind statically`,
        file: relFile,
        line,
        risk: 'high',
      });
    }

    function walkStatements(body) {
      for (const stmt of body) {
        const localInfo = flat.info.get(stmt) ?? {
          order: null,
          conditional: false,
        };
        const stmtInfo = inheritedConditional
          ? { ...localInfo, conditional: true }
          : localInfo;
        // Optional chaining is NOT a different registration: `app?.post(…)` and
        // `app.post?.(…)` are the plain forms whenever `app` exists, which it does in
        // any app that boots. Babel gives them distinct node types, and matching only
        // the plain ones dropped both routes silently — modelled here, not declared,
        // because the semantics are known exactly.
        const expr =
          stmt.type === 'ExpressionStatement' && isCall(stmt.expression)
            ? stmt.expression
            : null;
        if (!expr) continue;
        const callee = expr.callee;

        // Semantic setup link: require('./routes/index')(app) and its imported
        // equivalent are not router mounts syntactically. Their meaning is a
        // deterministic argument-to-parameter flow across files. Bind that parameter
        // only when the exported function is statically readable; otherwise declare
        // an UnknownHandler so a missing binding can never read as "0 routes".
        const semanticSetup = setupModuleBinding(expr, expressObjects, mod, absFile);
        if (semanticSetup) {
          if (semanticSetup.unresolved) {
            unknownRegistration('module-setup-unresolvable', semanticSetup.target, expr);
            continue;
          }
          const semanticOrder =
            depth === 0 ? stmtInfo.order : (baseOrder ?? stmtInfo.order);
          scanFile(
            semanticSetup.file,
            prefix,
            depth + 1,
            semanticOrder,
            semanticSetup.bindings,
            inheritedConditional || stmtInfo.conditional,
          );
          continue;
        }

        if (!isMember(callee)) continue;
        // A value that WAS proved to be an Express object and was then reassigned
        // has two possible runtime identities. Its registration is therefore
        // declared through the existing UnknownHandler channel, never guessed and
        // never allowed to disappear silently.
        const ambiguousReceiver = ambiguousRegistrationReceiver(expr, expressObjects);
        if (ambiguousReceiver) {
          unknownRegistration('ambiguous-express-binding', ambiguousReceiver.name, expr);
          continue;
        }
        // app[verb](…) — a COMPUTED registration: reading the property as a static name
        // would either drop it silently or, worse, mistake `app[v]` for `.use`. It is a
        // control-flow bifurcation the static eye cannot close: UnknownHandler, not a guess.
        if (
          callee.computed &&
          callee.object.type === 'Identifier' &&
          (expressObjects.isApp(callee.object) || expressObjects.isRouter(callee.object))
        ) {
          unknownRegistration('computed-method', callee.object.name, expr);
          continue;
        }
        if (callee.property.type !== 'Identifier') continue;
        // app.use.apply(app, args) / app.get.call(app, …) — indirection over a known
        // registration verb: same statically-unbindable class as the computed form.
        if (
          (callee.property.name === 'apply' || callee.property.name === 'call') &&
          isMember(callee.object) &&
          callee.object.object?.type === 'Identifier' &&
          (expressObjects.isApp(callee.object.object) ||
            expressObjects.isRouter(callee.object.object))
        ) {
          unknownRegistration('apply-call', callee.object.object.name, expr);
          continue;
        }
        // Reflect.apply(app.use, app, args)
        if (
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Reflect' &&
          callee.property.name === 'apply' &&
          isMember(expr.arguments[0]) &&
          expr.arguments[0].object?.type === 'Identifier' &&
          (expressObjects.isApp(expr.arguments[0].object) ||
            expressObjects.isRouter(expr.arguments[0].object))
        ) {
          unknownRegistration('reflect-apply', expr.arguments[0].object.name, expr);
          continue;
        }
        const obj = callee.object.type === 'Identifier' ? callee.object : null;
        const objName = obj?.name ?? null;

        // Effective declaration order: a route/mount declared directly in the entry file
        // takes its own statement position; one inside a mounted router takes effect at
        // the MOUNT's position (the framework wires the sub-router there) — so sequential
        // scope is inherited through nesting at every depth.
        const effOrder = depth === 0 ? stmtInfo.order : (baseOrder ?? stmtInfo.order);

        // app.route('/x').get(h).post(h) — the chainable Route API, straight out of the
        // Express docs. The receiver of `.post` is a CALL, not an app identifier, so the
        // plain dispatch below never sees it: every verb in the chain used to vanish
        // silently (Z1). The whole chain is registered here, in source order.
        const routeChain = routeChainOf(expr, expressObjects);
        if (routeChain) {
          if (routeChain.path === null) {
            skipped.push({
              reason: `dynamic path on ${routeChain.target}.route() — the chained verbs cannot be bound`,
              file: relFile,
              line: expr.loc?.start.line,
              risk: 'high',
            });
            unknownRegistration('route-chain-dynamic-path', routeChain.target, expr);
            continue;
          }
          for (const link of routeChain.verbs) {
            if (link.verb === 'all') {
              for (const verb of ALL_VERB_EXPANSION)
                registerRoute(
                  verb,
                  routeChain.path,
                  link.args,
                  link.node,
                  stmt,
                  stmtInfo,
                  effOrder,
                );
            } else if (HTTP.has(link.verb)) {
              registerRoute(
                link.verb,
                routeChain.path,
                link.args,
                link.node,
                stmt,
                stmtInfo,
                effOrder,
              );
            } else if (!NON_ROUTE_METHODS.has(link.verb)) {
              unknownRegistration(
                `route-chain-verb:${link.verb}`,
                routeChain.target,
                link.node,
              );
            }
          }
          continue;
        }

        // declarative mount loop: defaultRoutes.forEach((r) => router.use(r.path, r.route))
        // — the array of { path: '<literal>', route: <Identifier> } IS the router table
        if (callee.property.name === 'forEach' && objName && routeArrays.has(objName)) {
          for (const entry of routeArrays.get(objName)) {
            mounts.push({
              prefix: joinPath(prefix, entry.path),
              file: mod.imports.get(entry.ident) ?? null,
              ident: entry.ident,
              fromFile: relFile,
              depth: depth + 1,
              order: effOrder,
            });
          }
          continue;
        }

        if (!obj || (!expressObjects.isApp(obj) && !expressObjects.isRouter(obj)))
          continue;
        const method = callee.property.name;
        const args = expr.arguments;

        if (method === 'use') {
          handleUse(args, stmt, stmtInfo, effOrder);
          continue;
        }
        // `app.route('/x')` on its own registers nothing — the verbs come from the
        // chain, handled above. A bare statement here is a no-op, not a blind spot.
        if (method === 'route') continue;

        // `app.all(path, …)` answers EVERY verb — expand it, or the whole endpoint
        // is invisible while the app reads PROVEN (Z1).
        if (method === 'all') {
          const pathArg = args[0];
          if (!pathArg || pathArg.type !== 'StringLiteral') {
            skipped.push({
              reason: `dynamic path on ALL (non-literal first arg)`,
              file: relFile,
              line: expr.loc?.start.line,
              risk: 'high',
            });
            unknownRegistration('all-dynamic-path', objName, expr);
            continue;
          }
          for (const verb of ALL_VERB_EXPANSION)
            registerRoute(
              verb,
              pathArg.value,
              args.slice(1),
              expr,
              stmt,
              stmtInfo,
              effOrder,
            );
          continue;
        }

        if (HTTP.has(method)) {
          const pathArg = args[0];
          if (!pathArg || pathArg.type !== 'StringLiteral') {
            // the verb is modelled but the PATH is not a literal: the route exists and
            // its location is unknown, which is a registration SPARDA cannot bind — the
            // invariant applies here exactly as it does to an unmodelled member
            skipped.push({
              reason: `dynamic path on ${method.toUpperCase()} (non-literal first arg)`,
              file: relFile,
              line: expr.loc?.start.line,
              risk: 'high',
            });
            unknownRegistration(`dynamic-path:${method}`, objName, expr);
            continue;
          }
          registerRoute(
            method,
            pathArg.value,
            args.slice(1),
            expr,
            stmt,
            stmtInfo,
            effOrder,
          );
          continue;
        }

        // ── THE STRUCTURAL INVARIANT ──────────────────────────────────────────
        // Anything else called on an app/router object is a member SPARDA does not
        // model. It may be harmless plumbing — in which case its name belongs in
        // NON_ROUTE_METHODS, a deliberate, reviewable claim — or it may be a route
        // registration, in which case dropping it silently is exactly how an
        // unguarded endpoint disappears while the verdict reads PROVEN. There is no
        // silent third option: an unmodelled member becomes an UnknownHandler.
        if (NON_ROUTE_METHODS.has(method)) continue;
        unknownRegistration(`unmodelled-member:${method}`, objName, expr);
      }
    }

    // One route into the graph. Shared by the plain form (`app.post(path, …)`), the
    // all-verb expansion, and the chainable Route API — so every entry path applies
    // the same conditional-branch honesty and the same handler-chain resolution.
    // `handlerArgs` excludes the path: the chainable form has no path argument.
    function registerRoute(method, rawPath, handlerArgs, expr, stmt, stmtInfo, effOrder) {
      const fullPath = joinPath(prefix, rawPath);

      // A route born inside a conditional branch (if/loop/switch/ternary/&&) exists in
      // only PART of the executions. It stays in the graph (its findings must still
      // fire — soundness), but the uncertainty becomes a high-risk blind spot: the
      // surface is not fully modeled, so the verdict can no longer claim PROVEN.
      if (stmtInfo.conditional)
        skipped.push({
          reason: `conditional registration: ${method.toUpperCase()} ${fullPath} is declared inside a conditional branch — active in only part of the executions`,
          file: relFile,
          line: expr.loc?.start.line,
          risk: 'high',
        });

      const chain = [];
      for (let i = 0; i < handlerArgs.length; i++) {
        const resolved = resolveCallable(
          handlerArgs[i],
          mod,
          absFile,
          relFile,
          instanceVars,
          callableAliases,
        );
        if (!resolved) {
          skipped.push({
            reason: `unresolvable handler arg #${i + 1} on ${method.toUpperCase()} ${fullPath}`,
            file: relFile,
            line: handlerArgs[i].loc?.start.line,
          });
          continue;
        }
        resolved.role = i === handlerArgs.length - 1 ? 'handler' : 'middleware';
        chain.push(resolved);
      }

      const description = (stmt.leadingComments ?? expr.leadingComments ?? [])
        .map((c) =>
          c.value
            .replace(/^\*+/gm, '')
            .replace(/^\s*\*\s?/gm, '')
            .trim(),
        )
        .filter(Boolean)
        .join(' ')
        .slice(0, 400);

      routes.push({
        method,
        path: fullPath,
        sourceFile: relFile,
        sourceLine: expr.loc?.start.line ?? 0,
        params: pathParamsOf(fullPath),
        chain,
        description,
        order: effOrder,
        orderIn: stmtInfo.order,
        ...(stmtInfo.conditional ? { conditional: true } : {}),
      });
    }

    // `app.use('/x', fn)` — a callable mounted at a PATH. Express decides its role at
    // runtime: a MIDDLEWARE calls next() and the request continues, a terminal HANDLER
    // responds, and then that path IS an endpoint answering every verb. Reading the
    // function's BEHAVIOUR (does it hand control on?) rather than its position is the
    // same discipline as guard verification: no convention, no name test.
    //
    // Missing this was C3: an unauthenticated `deleteMany` mounted at
    // `app.use('/admin/wipe', handler)` never entered the graph at all.
    function handlePathedUse(args, pathValue, stmt, stmtInfo, effOrder) {
      const fullPath = joinPath(prefix, pathValue);
      for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a.type === 'StringLiteral') continue;
        if (isFrameworkPlumbing(a)) continue;
        const resolved = resolveCallable(
          a,
          mod,
          absFile,
          relFile,
          instanceVars,
          callableAliases,
        );
        if (!resolved) {
          unknownRegistration('pathed-use-unresolvable', fullPath, stmt);
          continue;
        }
        const role = pathedRole(resolved);
        if (role === 'handler') {
          // it answers, so the path is a real endpoint on every verb Express forwards
          for (const verb of ALL_VERB_EXPANSION)
            registerRoute(verb, pathValue, [a], stmt, stmt, stmtInfo, effOrder);
          continue;
        }
        // it hands control on (or its body is unreadable): a middleware scoped to the
        // prefix. Credited only to routes under it (Z6) and only at depth 0, where
        // `globalMiddlewares` is the right bucket; deeper, crediting a guard we cannot
        // order precisely could manufacture a PROVEN, so we decline and say so.
        if (depth === 0) {
          resolved.role = 'middleware';
          resolved.order = effOrder;
          resolved.orderIn = stmtInfo.order;
          resolved.pathPrefix = fullPath === '/' ? null : fullPath;
          if (stmtInfo.conditional) resolved.conditional = true;
          globalMiddlewares.push(resolved);
        }
        if (role === 'unknown') {
          // an unreadable body at a path could be either — declare the doubt so the
          // verdict cannot claim PROVEN over a surface whose shape we guessed
          unknownRegistration('pathed-use-opaque-body', fullPath, stmt);
        } else if (depth > 0) {
          unknownRegistration('pathed-use-nested-middleware', fullPath, stmt);
        }
      }
    }

    // Behaviour, not signature: a callable that references its `next` continuation is a
    // middleware; one that never can is terminal. An opaque body decides nothing.
    function pathedRole(resolved) {
      if (!resolved.fn) return 'unknown';
      return callsNext(resolved.fn) ? 'middleware' : 'handler';
    }

    // A router-value mount SPARDA met and could not prove. Recorded in the kernel
    // ledger rather than as a skipped surface on purpose: the shape must be
    // countable and named, and this slice changes route TOPOLOGY only — a blind
    // spot would move coverage and therefore a verdict.
    function declareRouterValue(arg, reason, stmt) {
      if (!kernel) return;
      const line = stmt.loc?.start.line ?? 0;
      const symbol = mountIdentName(arg);
      record(
        kernel,
        makeFact(
          'UnknownBoundary',
          factId('UnknownBoundary', relFile, line, `router-value:${symbol}`),
          {
            symbol,
            detail: `app.use(${symbol}) could not be proved to mount an Express Router — ${reason}`,
            owner: null,
          },
          {
            file: relFile,
            line,
            symbol,
            contract: 'express/router-value',
            uncertainty: 'unresolved-router-value',
          },
        ),
      );
    }

    function handleUse(args, stmt, stmtInfo, effOrder) {
      if (!args.length) return;
      // app.use('/prefix', router) → mount for second pass. The router arg is
      // usually an imported Identifier, but the inline-require idiom
      // `app.use('/x', require('./x.controller'))` (rootpath-style apps) is just
      // as common — resolve it directly. `undefined` = not a router mount at all
      // (fall through to global-middleware handling below).
      if (args[0].type === 'StringLiteral') {
        const target = mountTargetFile(args[1], mod, absFile);
        if (target !== undefined) {
          // conditional mount: everything under this prefix exists in only part of
          // the executions — the sub-tree still gets scanned (findings must fire),
          // but the uncertainty is declared and forbids PROVEN.
          if (stmtInfo.conditional)
            skipped.push({
              reason: `conditional mount: router at ${joinPath(prefix, args[0].value)} is mounted inside a conditional branch — its whole surface is active in only part of the executions`,
              file: relFile,
              line: stmt.loc?.start.line,
              risk: 'high',
            });
          mounts.push({
            prefix: joinPath(prefix, args[0].value),
            file: target, // null = named/required but unresolved → reported in the mounts loop
            ident: mountIdentName(args[1]),
            fromFile: relFile,
            depth: depth + 1, // nested mounts keep sinking, scanFile bounds them
            order: effOrder,
          });
          return;
        }
      }
      // PATH-SCOPED, not a router: `app.use('/api', expressjwt({…}))` (a middleware
      // Express runs ONLY under that prefix — crediting it everywhere was the Express
      // twin of E-NEXT-MW) or `app.use('/admin/wipe', handler)` (a terminal endpoint —
      // C3). handlePathedUse decides by behaviour and works at ANY depth, so a pathed
      // handler inside a mounted router is no longer dropped.
      if (args[0].type === 'StringLiteral') {
        handlePathedUse(args, args[0].value, stmt, stmtInfo, effOrder);
        return;
      }

      // `app.use(<non-literal>, routes)` — a mount whose PATH is a runtime value.
      // The router is provable and its location is not, so mounting it here would
      // publish the whole sub-tree at a prefix the app may never serve. Declared,
      // never mounted: an invented route is the one outcome this slice may not
      // produce.
      if (args.length > 1) {
        for (const a of args) {
          const f = mountTargetFile(a, mod, absFile);
          if (f !== undefined && exportsExpressRouter(f).router)
            declareRouterValue(
              a,
              'the mount path is not a literal, so the router\u2019s location is unknown',
              stmt,
            );
        }
      }

      // Unpathed `app.use(fn)`: applies to everything the object serves.
      for (const a of args) {
        if (isFrameworkPlumbing(a)) continue; // express.json() & friends: not app behavior
        // `app.use(routes)` where `routes` is a required module that STATICALLY
        // EXPORTS an Express Router is the pathed mount with its prefix left
        // implicit — the same router, mounted at this object's own prefix. It read
        // as one middleware named `routes` and its whole route tree disappeared
        // with no skipped surface and no boundary: 6 literal routes for
        // `app.use('/', routes)`, 0 for `app.use(routes)`.
        //
        // The discriminator is deliberately "does the module export a Router",
        // never "was it required from a relative path". A module exporting a
        // FUNCTION keeps its middleware treatment byte for byte — reading one as a
        // mount would move guard credit, which this slice may not do.
        const routerFile = mountTargetFile(a, mod, absFile);
        const verdict =
          routerFile !== undefined ? exportsExpressRouter(routerFile) : null;
        // ONE argument, exactly the shape the evidence describes: `app.use(routes)`.
        // With more arguments the first may be a non-literal PATH, and a router
        // mounted at a prefix nobody proved is an invented route.
        if (verdict && args.length === 1) {
          if (verdict.router) {
            if (stmtInfo.conditional)
              skipped.push({
                reason: `conditional mount: router at ${prefix || '/'} is mounted inside a conditional branch — its whole surface is active in only part of the executions`,
                file: relFile,
                line: stmt.loc?.start.line,
                risk: 'high',
              });
            mounts.push({
              prefix,
              file: routerFile,
              ident: mountIdentName(a),
              fromFile: relFile,
              depth: depth + 1,
              order: effOrder,
            });
            continue;
          }
        }
        // A `require(<non-literal>)` handed straight to `app.use` is a mount whose
        // MODULE is a runtime value. It resolves today as a middleware literally
        // named `require`, which is not a thing the program has — so it is declared
        // here rather than left wearing that name.
        const dynamicRequire =
          a.type === 'CallExpression' &&
          a.callee?.type === 'Identifier' &&
          a.callee.name === 'require' &&
          a.arguments[0]?.type !== 'StringLiteral';
        if (dynamicRequire)
          declareRouterValue(a, 'the required specifier is not a literal', stmt);
        // A value that was MOUNTED and could not be proved a Router is declared —
        // whether or not `resolveCallable` also has something to say about it. The
        // middleware entry below is untouched: this ADDS the admission, it does not
        // replace the model. A module exporting a FUNCTION is ordinary middleware
        // and is deliberately excluded, or every `app.use(cors)` in every
        // application would bury the handful of real refusals.
        else if (
          verdict &&
          !verdict.router &&
          !verdict.callable &&
          isRequiredModuleArg(a, mod)
        )
          declareRouterValue(a, verdict.reason, stmt);
        const resolved = resolveCallable(
          a,
          mod,
          absFile,
          relFile,
          instanceVars,
          callableAliases,
        );
        if (!resolved) {
          if (a.type !== 'CallExpression')
            skipped.push({
              reason: `unresolvable app.use() argument`,
              file: relFile,
              line: stmt.loc?.start.line,
              risk: 'high',
            });
          continue;
        }
        resolved.role = 'middleware';
        // declaration order travels with the middleware: translate only credits it to
        // routes declared AFTER it (the framework reads setup top-to-bottom). `orderIn`
        // is the position WITHIN this file, which is what separates two middlewares that
        // share a mount position — without it, a `router.use(auth)` at the bottom of a
        // router file would be credited to routes declared above it.
        resolved.order = effOrder;
        resolved.orderIn = stmtInfo.order;
        // Inside a MOUNTED router the middleware serves that router's prefix only — the
        // same scoping rule as the pathed form, applied to the mount point. Without it,
        // `router.use(requireAuth)` in an admin router was dropped entirely (a silent
        // loss of protection, so only false positives — but a loss all the same).
        if (depth > 0 && prefix && prefix !== '/') resolved.pathPrefix = prefix;
        if (stmtInfo.conditional) {
          // a conditionally-registered middleware may not exist at runtime; it keeps its
          // chain slot (never fabricate an UNGUARDED finding from uncertainty) but the
          // doubt is declared as a high-risk blind spot → PROVEN is barred
          resolved.conditional = true;
          skipped.push({
            reason: `conditional middleware: app.use(${resolved.name}) sits inside a conditional branch — its protection cannot be assumed for every execution`,
            file: relFile,
            line: stmt.loc?.start.line,
            risk: 'high',
          });
        }
        globalMiddlewares.push(resolved);
      }
    }
  }

  // Identifier → function body in this module, else in the module it was
  // imported from. Inline functions pass through as-is.
  function resolveCallable(
    arg,
    mod,
    absFile,
    relFile,
    instanceVars = new Map(),
    callableAliases = new Map(),
  ) {
    if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
      return {
        name: arg.id?.name ?? 'anonymous',
        sourceFile: relFile,
        sourceLine: arg.loc?.start.line ?? 0,
        fn: arg,
        // deep-scan the inline handler like every other callable branch: follows its
        // service/model calls AND carries the module's effect-client provenance (import
        // labels), so an SDK call in an inline handler is recognized by origin.
        scan: resolver.deepScan(arg, mod, { owner: arg.id?.name ?? 'anonymous' }),
      };
    }
    if (arg.type === 'CallExpression') {
      const name =
        arg.callee.type === 'Identifier'
          ? arg.callee.name
          : (arg.callee.property?.name ?? 'anonymous');
      // wrapped INLINE handler: asyncHandler(async (req, res) => {…}) — the
      // wrapped function IS the behavior (the route-position analogue of the
      // top-level `const h = catchAsync(…)` idiom). Without this, every
      // directus-style route reads as a blind node.
      const fnArg = arg.arguments.find(
        (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
      );
      if (fnArg) {
        return {
          name,
          sourceFile: relFile,
          sourceLine: fnArg.loc?.start.line ?? 0,
          fn: fnArg,
          scan: resolver.deepScan(fnArg, mod, { owner: name }),
        };
      }
      // known auth-library deny-form middleware (ADR-069): `passport.authenticate('jwt')`,
      // `expressjwt({…})`. Its body is in node_modules (opaque), but the catalog is a verified
      // published fact that it denies — so the guard reads VERIFIED, not asserted, and its app
      // can legitimately reach PROVEN. Deny-FORM precision (a custom callback / credentialsRequired
      // false) is handled in authDenyCall, which abstains rather than over-verify.
      if (authDenyCall(arg, mod.authGuards?.pkgOf)) {
        return {
          name,
          sourceFile: relFile,
          sourceLine: arg.loc?.start.line ?? 0,
          fn: null,
          scan: AUTH_DENY_SCAN,
        };
      }
      // factory middleware: validate(schema), rateLimit({…}) — the factory
      // name is known, the produced closure is out of static reach (blind node)
      return {
        name,
        sourceFile: relFile,
        sourceLine: arg.loc?.start.line ?? 0,
        fn: null,
      };
    }

    // controller.method — resolve through the import to the exported function
    // (including the catchAsync-wrapped const idiom)
    if (
      arg.type === 'MemberExpression' &&
      arg.object.type === 'Identifier' &&
      arg.property.type === 'Identifier'
    ) {
      const instance = instanceVars.get(arg.object.name);
      if (instance) {
        const target = parseModule(instance.file);
        const member = resolveInstanceMember(
          target,
          instance.typeName,
          arg.property.name,
        );
        if (member) {
          const fromRel = rel(instance.file);
          if (!scannedFiles.includes(fromRel)) {
            scannedFiles.push(fromRel);
            for (const [name, f] of target.functions)
              helpers.push({
                name,
                sourceFile: fromRel,
                sourceLine: f.line,
                fn: f.node,
              });
          }
          return {
            name: `${arg.object.name}.${arg.property.name}`,
            sourceFile: fromRel,
            sourceLine: member.line,
            fn: member.fn,
            // The handler is an arrow installed by `member.owner`; its
            // dependencies are declared in that constructor's scope, never in
            // its own body. Without the capture chain this scan resolves none
            // of its receivers and the whole service layer below disappears.
            scan: resolver.deepScan(member.fn, target, {
              captured: captureChain(member.owner ? [scopeBindings(member.owner)] : []),
              owner: `${arg.object.name}.${arg.property.name}`,
            }),
          };
        }
      }
      const importedFrom = mod.imports.get(arg.object.name);
      if (importedFrom) {
        const target = parseModule(importedFrom);
        const fn = target.functions.get(arg.property.name);
        if (fn) {
          const fromRel = rel(importedFrom);
          if (!scannedFiles.includes(fromRel)) {
            scannedFiles.push(fromRel);
            for (const [name, f] of target.functions)
              helpers.push({
                name,
                sourceFile: fromRel,
                sourceLine: f.line,
                fn: f.node,
              });
          }
          return {
            name: `${arg.object.name}.${arg.property.name}`,
            sourceFile: fromRel,
            sourceLine: fn.line,
            fn: fn.node,
            scan: resolver.deepScan(fn.node, target, {
              owner: `${arg.object.name}.${arg.property.name}`,
            }), // follow service/model calls below it
          };
        }
      }
      return {
        name: `${arg.object.name}.${arg.property.name}`,
        sourceFile: relFile,
        sourceLine: arg.loc?.start.line ?? 0,
        fn: null,
      };
    }

    if (arg.type !== 'Identifier') return null;

    const alias = callableAliases.get(arg.name);
    if (alias)
      return resolveCallable(alias, mod, absFile, relFile, instanceVars, callableAliases);

    const local = mod.functions.get(arg.name);
    if (local) {
      return {
        name: arg.name,
        sourceFile: relFile,
        sourceLine: local.line,
        fn: local.node,
        scan: resolver.deepScan(local.node, mod, { owner: arg.name }),
      };
    }
    const importedFrom = mod.imports.get(arg.name);
    if (importedFrom) {
      const target = parseModule(importedFrom);
      const fn = target.functions.get(arg.name) ?? target.functions.get('default');
      if (fn) {
        const fromRel = rel(importedFrom);
        if (!scannedFiles.includes(fromRel)) {
          scannedFiles.push(fromRel);
          for (const [name, f] of target.functions)
            helpers.push({
              name,
              sourceFile: fromRel,
              sourceLine: f.line,
              fn: f.node,
            });
        }
        return {
          name: arg.name,
          sourceFile: fromRel,
          sourceLine: fn.line,
          fn: fn.node,
          scan: resolver.deepScan(fn.node, target, { owner: arg.name }),
        };
      }
    }
    // aliased auth-library guard (ADR-069): `const requireAuth = passport.authenticate('jwt')`
    // used by name here — verified by the catalog, exactly like the inline form above.
    if (mod.authGuards?.denyBindings?.has(arg.name)) {
      return {
        name: arg.name,
        sourceFile: relFile,
        sourceLine: arg.loc?.start.line ?? 0,
        fn: null,
        scan: AUTH_DENY_SCAN,
      };
    }
    // known but bodyless — node exists, microscope stays blind
    return {
      name: arg.name,
      sourceFile: relFile,
      sourceLine: arg.loc?.start.line ?? 0,
      fn: null,
    };
  }

  function rel(abs) {
    return relOf(cwd, abs);
  }
}

// Statements the route walk should see = the module top level PLUS the bodies of
// setup functions and the control-flow blocks inside them, in source order. Bounded
// (depth + count) and cycle-free by construction. It descends into function *bodies*
// (declarations, default exports, `const f = () => {}`) and control flow (if/for/try/
// while/switch/block, plus call bifurcations behind ternaries and `&&`/`||`) — never
// into a function passed as a call ARGUMENT, so route handlers stay opaque.
//
// Returns { statements, info, limit }:
//   statements — the flattened stream, in declaration order
//   info       — Map<stmt, { order, conditional }>: `order` is the statement's formal
//                declaration position (the framework reads setup top-to-bottom — a
//                use() at position 50 never applies to a route at position 10);
//                `conditional` marks a statement reached only through a control-flow
//                bifurcation (if/else, loop body, switch case, catch handler, ternary
//                branch, short-circuit operand) — active in only part of the executions.
//   limit      — null, or a human-readable reason when a resource cap truncated the
//                walk: the caller MUST surface it (a silent cap fakes the coverage).
const FLATTEN_DEPTH_MAX = 6;
const FLATTEN_STMT_MAX = 8000;
export function flattenSetup(programBody) {
  const out = [];
  const info = new Map();
  let limit = null;
  const capped = (why) => {
    limit ??= why;
  };
  const blockOf = (n) => (!n ? [] : n.type === 'BlockStatement' ? n.body : [n]);
  const push = (stmts, depth, conditional) => {
    if (!Array.isArray(stmts)) return;
    if (depth > FLATTEN_DEPTH_MAX)
      return capped(`setup nesting deeper than ${FLATTEN_DEPTH_MAX} levels`);
    for (const s of stmts) {
      if (!s || typeof s !== 'object') continue;
      if (out.length >= FLATTEN_STMT_MAX)
        return capped(`setup statement cap (${FLATTEN_STMT_MAX}) reached`);
      out.push(s);
      info.set(s, { order: out.length - 1, conditional });
      descend(s, depth, conditional);
    }
  };
  // call bifurcations hidden in EXPRESSIONS: `flag && app.use(auth)`,
  // `flag ? app.use(a) : app.use(b)`, `(app.use(a), app.use(b))`. Each reachable
  // CallExpression is surfaced as a synthetic ExpressionStatement so the route walk
  // sees it — marked conditional whenever a branch/short-circuit guards it.
  const pushExprCalls = (expr, depth, conditional) => {
    if (!expr || typeof expr !== 'object') return;
    switch (expr.type) {
      case 'CallExpression':
        push(
          [{ type: 'ExpressionStatement', expression: expr, loc: expr.loc }],
          depth,
          conditional,
        );
        break;
      case 'ConditionalExpression':
        pushExprCalls(expr.consequent, depth, true);
        pushExprCalls(expr.alternate, depth, true);
        break;
      case 'LogicalExpression':
        pushExprCalls(expr.left, depth, conditional);
        pushExprCalls(expr.right, depth, true); // the right side runs only if the left short-circuits its way
        break;
      case 'SequenceExpression':
        for (const e of expr.expressions) pushExprCalls(e, depth, conditional);
        break;
    }
  };
  const descend = (s, depth, conditional) => {
    switch (s.type) {
      case 'FunctionDeclaration':
        push(s.body?.body, depth + 1, conditional);
        break;
      case 'ExportDefaultDeclaration':
      case 'ExportNamedDeclaration':
        if (s.declaration?.body?.body)
          push(s.declaration.body.body, depth + 1, conditional);
        else if (s.declaration) push([s.declaration], depth, conditional);
        break;
      case 'VariableDeclaration':
        for (const d of s.declarations) {
          const init = d.init;
          if (
            (init?.type === 'ArrowFunctionExpression' ||
              init?.type === 'FunctionExpression') &&
            init.body?.body
          )
            push(init.body.body, depth + 1, conditional);
        }
        break;
      case 'ExpressionStatement':
        // only bifurcation carriers — a plain CallExpression statement is already
        // in the stream and must not be duplicated
        if (
          s.expression?.type === 'ConditionalExpression' ||
          s.expression?.type === 'LogicalExpression' ||
          s.expression?.type === 'SequenceExpression'
        )
          pushExprCalls(s.expression, depth, conditional);
        break;
      case 'IfStatement':
        push(blockOf(s.consequent), depth, true);
        push(blockOf(s.alternate), depth, true);
        break;
      case 'SwitchStatement':
        for (const c of s.cases ?? []) push(c.consequent, depth, true);
        break;
      case 'TryStatement':
        // the try block runs unconditionally in sequence (like any statement list);
        // the catch handler runs ONLY on an exception — that is a bifurcation
        push(s.block?.body, depth, conditional);
        if (s.handler?.body?.body) push(s.handler.body.body, depth, true);
        push(s.finalizer?.body, depth, conditional);
        break;
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
        // a loop body may run zero times — reaching it is not a certainty
        push(blockOf(s.body), depth, true);
        break;
      case 'DoWhileStatement':
        // a do-while body runs at least once — its first pass IS certain
        push(blockOf(s.body), depth, conditional);
        break;
      case 'BlockStatement':
        push(s.body, depth, conditional);
        break;
    }
  };
  push(programBody, 0, false);
  return { statements: out, info, limit };
}

// const defaultRoutes = [{ path: '/auth', route: authRoute }, …] — collected
// per file so a later .forEach mount loop can be unrolled statically
function collectRouteArrays(body) {
  const arrays = new Map();
  for (const node of body) {
    const decl = node.type === 'VariableDeclaration' ? node : null;
    if (!decl) continue;
    for (const d of decl.declarations) {
      if (d.id?.type !== 'Identifier' || d.init?.type !== 'ArrayExpression') continue;
      const entries = [];
      for (const el of d.init.elements) {
        if (el?.type !== 'ObjectExpression') continue;
        let entryPath = null;
        let ident = null;
        for (const prop of el.properties) {
          if (prop.type !== 'ObjectProperty' || prop.key.type !== 'Identifier') continue;
          if (prop.key.name === 'path' && prop.value.type === 'StringLiteral')
            entryPath = prop.value.value;
          if (prop.key.name === 'route' && prop.value.type === 'Identifier')
            ident = prop.value.name;
        }
        if (entryPath && ident) entries.push({ path: entryPath, ident });
      }
      if (entries.length) arrays.set(d.id.name, entries);
    }
  }
  return arrays;
}

// The second arg of app.use('/p', X): where does the mounted router live?
//   Identifier            → the import it resolves to (null if unresolved)
//   require('./x')        → the relative file it resolves to (null if non-relative)
//   anything else         → undefined (not a router mount; e.g. a middleware call)
function mountTargetFile(arg, mod, absFile) {
  if (!arg) return undefined;
  if (arg.type === 'Identifier') {
    // a function DEFINED in this module is a callable (middleware or handler), never a
    // mounted router — reading it as an unresolved mount lost it entirely
    if (mod.functions?.has(arg.name)) return undefined;
    return mod.imports.get(arg.name) ?? null;
  }
  if (
    arg.type === 'CallExpression' &&
    arg.callee.type === 'Identifier' &&
    arg.callee.name === 'require' &&
    arg.arguments[0]?.type === 'StringLiteral'
  ) {
    // `require` may be a local binding wearing the host's name. Resolving it
    // would mount the routes of a file this call never loads, so the mount is
    // reported unresolved (`null`) and becomes a declared skipped surface.
    if (mod?.requireShadowed) return null;
    return resolveRelImport(absFile, arg.arguments[0].value);
  }
  return undefined;
}

// a readable identifier for the mount's skipped-report when it can't resolve
function mountIdentName(arg) {
  if (arg?.type === 'Identifier') return arg.name;
  if (
    arg?.type === 'CallExpression' &&
    arg.callee.type === 'Identifier' &&
    arg.callee.name === 'require' &&
    arg.arguments[0]?.type === 'StringLiteral'
  )
    return `require('${arg.arguments[0].value}')`;
  return 'router';
}

// A direct or imported CommonJS setup call can move an Express instance across a
// file boundary without ever spelling app.use(). This is a small, strict first slice
// of the semantic linker: AST supplies the facts; positional parameter binding makes
// the interprocedural edge. It deliberately understands no reflection, spreads or
// computed module names — those remain explicit uncertainty.
function setupModuleBinding(expr, expressObjects, mod, absFile) {
  const target = setupModuleTarget(expr, mod, absFile);
  if (!target) return null;

  const hasExpressArgument = expr.arguments.some(
    (arg) =>
      arg?.type === 'Identifier' &&
      (expressObjects.isApp(arg) || expressObjects.isRouter(arg)),
  );
  if (!hasExpressArgument) return null;
  if (!target.file) return { unresolved: true, target: target.label };

  const targetModule = parseModule(target.file);
  const entrypoint = setupEntrypoint(targetModule);
  if (!entrypoint) return { unresolved: true, target: target.label };

  const app = [];
  const router = [];
  for (
    let index = 0;
    index < Math.min(entrypoint.params.length, expr.arguments.length);
    index++
  ) {
    const param = entrypoint.params[index];
    const argument = expr.arguments[index];
    if (param?.type !== 'Identifier' || argument?.type !== 'Identifier') continue;
    if (expressObjects.isApp(argument)) app.push(param.name);
    if (expressObjects.isRouter(argument)) router.push(param.name);
  }
  if (!app.length && !router.length) return { unresolved: true, target: target.label };

  return {
    file: target.file,
    bindings: { app, router, entrypoint },
  };
}

function setupModuleTarget(expr, mod, absFile) {
  const callee = expr?.callee;
  if (
    callee?.type === 'CallExpression' &&
    callee.callee?.type === 'Identifier' &&
    callee.callee.name === 'require' &&
    callee.arguments[0]?.type === 'StringLiteral'
  ) {
    const specifier = callee.arguments[0].value;
    return {
      file: resolveRelImport(absFile, specifier),
      label: "require('" + specifier + "')",
    };
  }
  if (callee?.type === 'Identifier' && mod.imports.has(callee.name))
    return { file: mod.imports.get(callee.name), label: callee.name };
  return null;
}

function setupEntrypoint(mod) {
  if (!mod?.ast || mod.error) return null;
  for (const node of mod.ast.program.body) {
    const assignment =
      node.type === 'ExpressionStatement' &&
      node.expression?.type === 'AssignmentExpression'
        ? node.expression
        : null;
    if (!assignment || !isModuleExports(assignment.left)) continue;
    const rhs = assignment.right;
    if (rhs.type === 'FunctionExpression' || rhs.type === 'ArrowFunctionExpression')
      return rhs;
    if (rhs.type === 'Identifier') return mod.functions.get(rhs.name)?.node ?? null;
  }
  const esmDefault = mod.ast.program.body.find(
    (node) =>
      node.type === 'ExportDefaultDeclaration' &&
      (node.declaration?.type === 'FunctionDeclaration' ||
        node.declaration?.type === 'FunctionExpression' ||
        node.declaration?.type === 'ArrowFunctionExpression'),
  );
  return esmDefault?.declaration ?? null;
}

function isModuleExports(node) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    node.object.name === 'module' &&
    node.property?.type === 'Identifier' &&
    node.property.name === 'exports'
  );
}

function setupBindingKey(bindings) {
  if (!bindings) return 'root';
  const id = bindings.entrypoint?.loc?.start?.line ?? 0;
  const app = [...(bindings.app ?? [])].sort().join(',');
  const router = [...(bindings.router ?? [])].sort().join(',');
  return [id, 'app=' + app, 'router=' + router].join(':');
}

// Optional chaining produces distinct Babel node types for the SAME semantics —
// `app?.post(…)` is `app.post(…)` whenever `app` exists, which it does in any app that
// boots. Treating them as different used to drop the registration silently.
const isCall = (n) =>
  n?.type === 'CallExpression' || n?.type === 'OptionalCallExpression';
const isMember = (n) =>
  n?.type === 'MemberExpression' || n?.type === 'OptionalMemberExpression';

// `express.json()` / `cors()` / `helmet()` and friends: framework plumbing that carries
// no application behaviour. Excluded from middleware collection so the chain stays about
// the app, not the boilerplate.
function isFrameworkPlumbing(a) {
  if (!isCall(a)) return false;
  const c = a.callee;
  if (isMember(c) && c.object?.type === 'Identifier' && c.object.name === 'express')
    return true;
  return (
    c?.type === 'Identifier' &&
    /^(cors|helmet|morgan|compression|cookieparser|bodyparser)$/i.test(c.name)
  );
}

// Does this callable hand control on? Express passes the continuation as the third
// parameter; a function that never references it cannot continue the chain, so it is a
// terminal handler. Reading the BEHAVIOUR rather than the signature keeps the decision
// honest — a `(req, res, next)` that never calls next IS terminal, and this says so.
// Bounded walk, no recursion into nested function bodies (a `next` captured by an inner
// closure still counts as referenced, which is the conservative direction: it keeps the
// callable classified as middleware rather than inventing endpoints).
function callsNext(fnNode) {
  const params = fnNode?.params ?? [];
  const nextParam = params[2];
  // fewer than three params: no continuation was bound, so it cannot call one
  if (!nextParam) return false;
  const name = nextParam.type === 'Identifier' ? nextParam.name : null;
  if (!name) return true; // destructured/rest continuation — assume it continues
  let found = false;
  let budget = 20000;
  const walk = (node) => {
    if (found || !node || typeof node !== 'object' || budget-- <= 0) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node.type === 'Identifier' && node.name === name) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments')
        continue;
      const v = node[key];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(fnNode.body);
  return found;
}

// `app.route('/x').get(h).post(h)` — the chainable Route API. The receiver of the
// outermost verb is a CALL, not an app identifier, so the plain dispatch cannot see
// it. Walks the chain down to its `X.route(path)` base and returns every verb in it,
// in source order — or null when this statement is not a route chain at all.
// `path: null` marks a base whose path is not a literal (the verbs exist but cannot
// be bound — an UnknownHandler, never a silent drop).
function routeChainOf(callExpr, expressObjects) {
  const verbs = [];
  let cur = callExpr;
  // bounded: a real chain is a handful of verbs; the cap only stops pathological input
  for (let hops = 0; hops < 64; hops++) {
    if (
      !isCall(cur) ||
      !isMember(cur.callee) ||
      cur.callee.computed ||
      cur.callee.property?.type !== 'Identifier'
    )
      return null;
    const name = cur.callee.property.name;
    const inner = cur.callee.object;
    if (name === 'route') {
      if (inner?.type !== 'Identifier') return null;
      if (!expressObjects.isApp(inner) && !expressObjects.isRouter(inner)) return null;
      const p = cur.arguments[0];
      return {
        target: inner.name,
        path: p?.type === 'StringLiteral' ? p.value : null,
        verbs: verbs.reverse(), // collected outermost-first, replayed in source order
      };
    }
    verbs.push({ verb: name, args: [...cur.arguments], node: cur });
    cur = inner;
  }
  return null;
}

// Build one lexical provenance view over the AST. This is not a second behavior
// graph: it is a local admission predicate for the existing Express lowering.
// Babel Binding objects are scope-specific, so two identifiers with the same text
// cannot share credit. The returned predicates accept the original AST Identifier
// nodes used by `flattenSetup`, preserving that identity through the existing walk.
function collectExpressObjects(ast, semanticBindings = null) {
  const bindingAt = new WeakMap();
  const declarators = [];
  const assignments = [];
  const expressFactories = new Set();
  const routerFactories = new Set();
  const appBindings = new Set();
  const routerBindings = new Set();
  const ambiguousBindings = new Set();
  let semanticEntrypointPath = null;

  const bindingOf = (identifier) =>
    identifier?.type === 'Identifier' ? (bindingAt.get(identifier) ?? null) : null;
  const addBinding = (set, identifier) => {
    const binding = bindingOf(identifier);
    if (binding) set.add(binding);
  };
  const unshadowedRequire = (call) =>
    call?.type === 'CallExpression' &&
    call.callee?.type === 'Identifier' &&
    call.callee.name === 'require' &&
    bindingOf(call.callee) === null;
  const expressRequire = (call) =>
    unshadowedRequire(call) &&
    call.arguments[0]?.type === 'StringLiteral' &&
    call.arguments[0].value === EXPRESS_PACKAGE;

  traverse(ast, {
    Identifier(path) {
      const binding = path.scope.getBinding(path.node.name);
      if (binding) bindingAt.set(path.node, binding);
    },
    ImportDeclaration(path) {
      if (path.node.source.value !== EXPRESS_PACKAGE) return;
      for (const specifier of path.node.specifiers) {
        const binding = path.scope.getBinding(specifier.local.name);
        if (!binding) continue;
        const imported =
          specifier.type === 'ImportSpecifier'
            ? (specifier.imported?.name ?? specifier.imported?.value)
            : 'default';
        if (imported === 'Router') routerFactories.add(binding);
        else if (
          specifier.type === 'ImportDefaultSpecifier' ||
          specifier.type === 'ImportNamespaceSpecifier' ||
          imported === 'default'
        )
          expressFactories.add(binding);
      }
    },
    TSImportEqualsDeclaration(path) {
      const ref = path.node.moduleReference;
      if (
        ref?.type === 'TSExternalModuleReference' &&
        ref.expression?.type === 'StringLiteral' &&
        ref.expression.value === EXPRESS_PACKAGE
      ) {
        const binding = path.scope.getBinding(path.node.id.name);
        if (binding) expressFactories.add(binding);
      }
    },
    VariableDeclarator(path) {
      declarators.push(path.node);
    },
    AssignmentExpression(path) {
      assignments.push(path.node);
    },
    Function(path) {
      if (path.node === semanticBindings?.entrypoint) semanticEntrypointPath = path;
    },
  });

  // CommonJS package bindings. A locally declared `require` is not Node's loader
  // and therefore cannot establish package provenance.
  for (const d of declarators) {
    if (!expressRequire(d.init)) continue;
    if (d.id?.type === 'Identifier') addBinding(expressFactories, d.id);
    if (d.id?.type !== 'ObjectPattern') continue;
    for (const property of d.id.properties ?? [])
      if (
        property.type === 'ObjectProperty' &&
        !property.computed &&
        (property.key?.name ?? property.key?.value) === 'Router' &&
        property.value?.type === 'Identifier'
      )
        addBinding(routerFactories, property.value);
  }

  // A semantic setup link proves which exact parameter received the app/router
  // object. Seed only the Binding belonging to that exported function.
  if (semanticEntrypointPath)
    for (const param of semanticEntrypointPath.node.params ?? []) {
      if (param.type !== 'Identifier') continue;
      const binding = semanticEntrypointPath.scope.getBinding(param.name);
      if (!binding) continue;
      if ((semanticBindings?.app ?? []).includes(param.name)) appBindings.add(binding);
      if ((semanticBindings?.router ?? []).includes(param.name))
        routerBindings.add(binding);
    }

  const unstableFactories = new Set(
    [...expressFactories, ...routerFactories].filter(
      (binding) => (binding.constantViolations?.length ?? 0) > 0,
    ),
  );
  const factoryKindOf = (init) => {
    if (init?.type !== 'CallExpression') return null;
    const callee = init.callee;
    if (callee?.type === 'Identifier') {
      const binding = bindingOf(callee);
      if (expressFactories.has(binding))
        return unstableFactories.has(binding) ? 'ambiguous' : 'app';
      if (routerFactories.has(binding))
        return unstableFactories.has(binding) ? 'ambiguous' : 'router';
      return null;
    }
    if (
      callee?.type !== 'MemberExpression' ||
      callee.computed ||
      callee.property?.type !== 'Identifier' ||
      callee.property.name !== 'Router'
    )
      return null;
    if (expressRequire(callee.object)) return 'router';
    const binding = bindingOf(callee.object);
    if (!expressFactories.has(binding)) return null;
    return unstableFactories.has(binding) ? 'ambiguous' : 'router';
  };
  const kindOf = (identifier) => {
    const binding = bindingOf(identifier);
    if (!binding || ambiguousBindings.has(binding)) return null;
    if (appBindings.has(binding)) return 'app';
    if (routerBindings.has(binding)) return 'router';
    return null;
  };

  // Construction and aliases form a finite closure over Babel Bindings. The
  // fixpoint preserves the old alias-of-alias capability without merging scopes.
  for (let pass = 0; pass < 8; pass++) {
    const before = appBindings.size + routerBindings.size + ambiguousBindings.size;
    for (const d of declarators) {
      if (d.id?.type !== 'Identifier' || !d.init) continue;
      const target = bindingOf(d.id);
      if (!target) continue;
      // Keep this branch explicit: the mutation harness removes it to prove that
      // alias propagation remains guarded after the representation changed.
      if (d.init.type === 'Identifier') {
        const source = bindingOf(d.init);
        if (ambiguousBindings.has(source)) ambiguousBindings.add(target);
        else if (appBindings.has(source)) appBindings.add(target);
        else if (routerBindings.has(source)) routerBindings.add(target);
        continue;
      }
      const kind = factoryKindOf(d.init);
      if (kind === 'app') appBindings.add(target);
      else if (kind === 'router') routerBindings.add(target);
      else if (kind === 'ambiguous') ambiguousBindings.add(target);
    }
    for (const assignment of assignments) {
      if (
        assignment.operator !== '=' ||
        assignment.left?.type !== 'Identifier' ||
        assignment.right?.type !== 'Identifier'
      )
        continue;
      const target = bindingOf(assignment.left);
      const source = bindingOf(assignment.right);
      if (!target) continue;
      if (ambiguousBindings.has(source)) ambiguousBindings.add(target);
      else if (appBindings.has(source)) appBindings.add(target);
      else if (routerBindings.has(source)) routerBindings.add(target);
    }
    if (before === appBindings.size + routerBindings.size + ambiguousBindings.size) break;
  }

  // A later non-equivalent write makes the binding's runtime identity uncertain.
  // Exact app→app / router→router alias assignments remain admitted; everything
  // else uses the existing declared-unknown path at registration sites.
  for (const binding of [...appBindings, ...routerBindings]) {
    const expected = appBindings.has(binding) ? 'app' : 'router';
    const stable = (binding.constantViolations ?? []).every((violation) => {
      const assignment = violation.node;
      return (
        assignment?.type === 'AssignmentExpression' &&
        assignment.operator === '=' &&
        assignment.left?.type === 'Identifier' &&
        bindingOf(assignment.left) === binding &&
        kindOf(assignment.right) === expected
      );
    });
    if (!stable) ambiguousBindings.add(binding);
  }

  return {
    isApp: (identifier) => {
      const binding = bindingOf(identifier);
      return (
        binding !== null && appBindings.has(binding) && !ambiguousBindings.has(binding)
      );
    },
    isRouter: (identifier) => {
      const binding = bindingOf(identifier);
      return (
        binding !== null && routerBindings.has(binding) && !ambiguousBindings.has(binding)
      );
    },
    isAmbiguous: (identifier) => ambiguousBindings.has(bindingOf(identifier)),
  };
}

function ambiguousRegistrationReceiver(expr, expressObjects) {
  const callee = expr?.callee;
  if (!isMember(callee)) return null;

  const staticMethod = (member) =>
    !member.computed && member.property?.type === 'Identifier'
      ? member.property.name
      : null;
  const registrationMember = (member) => {
    if (!isMember(member)) return false;
    if (member.computed) return true;
    const method = staticMethod(member);
    return HTTP.has(method) || method === 'all' || method === 'use' || method === 'route';
  };
  const baseIdentifier = (member) => {
    let cursor = member;
    for (let depth = 0; depth < 8 && isMember(cursor); depth++) {
      if (cursor.object?.type === 'Identifier') return cursor.object;
      if (cursor.object?.type !== 'CallExpression' || !isMember(cursor.object.callee))
        return null;
      cursor = cursor.object.callee;
    }
    return null;
  };
  const ambiguousBase = (member) => {
    const identifier = baseIdentifier(member);
    return identifier && expressObjects.isAmbiguous(identifier) ? identifier : null;
  };

  // Direct registrations and route chains: app.post(…), app.route(…).post(…).
  if (registrationMember(callee)) return ambiguousBase(callee);

  // app.post.call(…), app.post.apply(…).
  const method = staticMethod(callee);
  if ((method === 'apply' || method === 'call') && registrationMember(callee.object))
    return ambiguousBase(callee.object);

  // Reflect.apply(app.post, …).
  if (
    method === 'apply' &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'Reflect' &&
    registrationMember(expr.arguments[0])
  )
    return ambiguousBase(expr.arguments[0]);

  return null;
}

// Constructor instances and callback aliases are local semantic facts of one setup
// scope. They are deliberately collected only from the flattened setup body, never
// from handlers: `const h = new Handler(); app.post('/x', h.update)` is a route-time
// binding, whereas a `new` hidden inside a handler says nothing about its registration.
function collectInstanceVars(body, mod) {
  const instances = new Map();
  for (const node of body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const declaration of node.declarations) {
      if (declaration.id?.type !== 'Identifier') continue;
      const init = declaration.init;
      if (
        init?.type === 'NewExpression' &&
        init.callee?.type === 'Identifier' &&
        mod.imports.has(init.callee.name)
      ) {
        instances.set(declaration.id.name, {
          typeName: init.callee.name,
          file: mod.imports.get(init.callee.name),
        });
      } else if (init?.type === 'Identifier' && instances.has(init.name)) {
        instances.set(declaration.id.name, instances.get(init.name));
      }
    }
  }
  return instances;
}

function collectCallableAliases(body) {
  const aliases = new Map();
  for (const node of body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const declaration of node.declarations)
      if (
        declaration.id?.type === 'Identifier' &&
        declaration.init?.type === 'MemberExpression'
      )
        aliases.set(declaration.id.name, declaration.init);
  }
  return aliases;
}

function pathParamsOf(fullPath) {
  return [...fullPath.matchAll(/:(\w+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    type: 'string',
    required: true,
  }));
}

function joinPath(prefix, p) {
  const joined = `${prefix ?? ''}${p === '/' && prefix ? '' : p}`.replace(/\/{2,}/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

export { resolveRelImport };
