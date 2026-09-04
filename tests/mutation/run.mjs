// tests/mutation/run.mjs — home-grown mutation testing (zero new dependency, fits the 4-dep
// ethos). The biological technique reproduced: DNA polymerase's coupled proofreading + natural
// selection. A test suite is only as good as its ability to KILL mutants — introduce a mutation
// into a critical invariant, run the test that should catch it, and require the test to FAIL. A
// mutant that SURVIVES (test still passes) is a hole in the suite: behavior with no guardian.
//
//   npm run mutation
//
// Each mutant targets a soundness- or correctness-critical line shipped recently. Add a mutant
// whenever you add such a line — that is the rule (verification COUPLED to the change).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => path.join(repo, p);
const VITEST = f('node_modules/vitest/vitest.mjs');

// EXPORTED, and the run below is guarded behind "am I the entry point?", so
// `tests/no-mutant-left-behind.test.js` can read this list in the ordinary suite without
// executing 126 mutants. That test asks the one question this file cannot ask itself: is a
// mutation still sitting in the working tree right now? (E-108.)
export const MUTANTS = [
  {
    desc: 'soundness bench: ignore a route-local declared uncertainty (false clean)',
    file: 'bench/soundness/run.mjs',
    find: "      : routeBlindspot || routeDeclaredUncertainty\n        ? 'UNKNOWN'\n        : 'CLEAN';",
    repl: 'routeBlindspot || false',
    test: 'tests/soundness-bench.test.js',
  },
  {
    desc: 'soundness bench: invent a complete route-recall percentage when unmeasured',
    file: 'bench/soundness/run.mjs',
    find: 'routeRecall: ratio(observedRoutes.length, vulnerable.length),',
    repl: 'routeRecall: 1,',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'express: skip a callback-held CommonJS setup factory (NodeGoat routes vanish)',
    file: 'src/ubg/express.js',
    find: 'if (!semanticSetup) continue;',
    repl: 'if (true) continue;',
    test: 'tests/semantic-linker.test.js',
  },
  {
    desc: 'express: leave a CommonJS constructor handler opaque (factory behavior vanishes)',
    file: 'src/ubg/express.js',
    find: 'if (member) {',
    repl: 'if (false) {',
    test: 'tests/semantic-linker.test.js',
  },
  {
    desc: 'llm-resolve: drop the structural verification (admit any hint)',
    file: 'src/ubg/llm-resolve.js',
    find: 'const denies = proveDeny(hint) === true;',
    repl: 'const denies = true;',
    test: 'tests/llm-resolve.test.js',
  },
  {
    desc: 'prisma: stop collecting .prisma files from the schema folder (E-046)',
    file: 'src/ubg/prisma.js',
    find: "else if (e.name.endsWith('.prisma')) files.push(p);",
    repl: 'else if (false) files.push(p);',
    test: 'tests/prisma-folder.test.js',
  },
  {
    desc: 'apocalypse: never infer the direct-owner ownership model (BolaRay)',
    file: 'src/ubg/apocalypse.js',
    find: "if (direct) return { model: 'direct-owner', key: direct };",
    repl: "if (false) return { model: 'direct-owner', key: direct };",
    test: 'tests/prisma-folder.test.js',
  },
  {
    desc: 'apocalypse: a collapsed flood silently becomes advisory (would hide a danger)',
    file: 'src/ubg/apocalypse.js',
    find: 'const anyHard = list.some((f) => !f.advisory);',
    repl: 'const anyHard = false;',
    test: 'tests/flood-collapse.test.js',
  },
  {
    desc: 'stitch: stop excluding a service from stitching to itself (phantom self-calls)',
    file: 'src/ubg/stitch.js',
    find: 'if (c.service === svc.name) continue; // never stitch a service to itself',
    repl: 'if (false) continue; // never stitch a service to itself',
    test: 'tests/stitch.test.js',
  },
  {
    desc: 'apocalypse: drop the E-047 blind-spot rung (bare PROVEN over high blind spots)',
    file: 'src/ubg/apocalypse.js',
    find: 'blindHigh > 0 ||',
    repl: 'false ||',
    test: 'tests/verdict-partial.test.js',
  },
  {
    desc: 'extract: disable workspace-package resolution (E-048 cross-package writes blind)',
    file: 'src/ubg/extract.js',
    find: "  if (spec.startsWith('.') || spec.startsWith('/')) return null;\n  const map = workspacePackages(fromFile);",
    repl: 'const map = null;',
    test: 'tests/workspace-resolve.test.js',
  },
  {
    desc: 'prisma: stop resolving a shared workspace schema (P4 state layer blind)',
    file: 'src/ubg/prisma.js',
    find: ': workspaceSchemaFiles(cwd, candidates, SCHEMA_DIR_CANDIDATES);',
    repl: ': [];',
    test: 'tests/workspace-resolve.test.js',
  },
  {
    desc: 'extract: stop recognizing a call-site ownership assertion (G1 false BOLA returns)',
    file: 'src/ubg/extract.js',
    find: 'if (callAssertsOwnership(node, ctx)) out.ownerAsserted = true;',
    repl: 'if (false) out.ownerAsserted = true;',
    test: 'tests/g1-ownership-assert.test.js',
  },
  {
    desc: 'apocalypse: treat any credential family as gated even with no refusal shape (G2)',
    file: 'src/ubg/apocalypse.js',
    find: 'family !== null && (credGates || (callbackish && credRedirects));',
    repl: 'family !== null && true;',
    test: 'tests/g2-credential-gate.test.js',
  },
  {
    desc: 'apocalypse: proof object claims a guardless mutation as discharged (fake proof)',
    file: 'src/ubg/apocalypse.js',
    find: 'if (!writes.length || !guards.length) continue;',
    repl: 'if (!writes.length) continue;',
    test: 'tests/proof-objects.test.js',
  },
  {
    desc: 'extract: stop seeing a named-refusal helper (API-key/first-run refusal goes blind)',
    file: 'src/ubg/extract.js',
    find: '    out.credentialSignals.denies4xxOrThrows = true;\n\n  // ---- local calls',
    repl: '    void 0;\n\n  // ---- local calls',
    test: 'tests/g2-credential-gate.test.js',
  },
  {
    desc: 'state-min: drop the advisory body signals when a delegator is merged (false critical returns)',
    file: 'src/ubg/passes/state-minimization.js',
    find: '    if (b.meta[k]) a.meta[k] = true;',
    repl: '    if (false) a.meta[k] = true;',
    // Direct unit test of the merge propagation — bites the line regardless of resolution path.
    // (The g2 end-to-end fixture now carries the same signal by a second path once inline handlers
    // are deep-scanned, so it no longer uniquely depends on this line — ADR-061.)
    test: 'tests/state-min-signals.test.js',
  },
  {
    desc: 'apocalypse: re-label a NON-public route as public-by-design (Class 1 blanket, hides holes)',
    file: 'src/ubg/apocalypse.js',
    find: 'const softened = credentialGated || expectedPublic;',
    repl: 'const softened = credentialGated || true;',
    test: 'tests/g2-credential-gate.test.js',
  },
  {
    desc: 'apocalypse: public-by-design re-label stops abstaining in an authenticated namespace (2FA-register / webhook-management holes return)',
    file: 'src/ubg/apocalypse.js',
    find: '        !credentialGated &&\n        !authenticatedArea &&',
    repl: '        !credentialGated &&\n        !false &&',
    test: 'tests/public-path-overreach.test.js',
  },
  {
    desc: 'apocalypse: stop flagging a mutation that runs before its guard (C2 false PROVEN returns)',
    file: 'src/ubg/apocalypse.js',
    find: 'guards.length > 0 ? writes.filter((w) => w.effect.meta.bypassesGuard) : [];',
    repl: '[];',
    test: 'tests/guard-dominance.test.js',
  },
  {
    desc: 'extract: never mark a mutation as running before its guard (guard-dominance goes blind)',
    file: 'src/ubg/extract.js',
    find: 'if (result.hasInBodyGuard && e._unguardedPath) e.bypassesGuard = true;',
    repl: 'if (false) e.bypassesGuard = true;',
    test: 'tests/guard-dominance.test.js',
  },
  {
    desc: 'nextjs: stop extracting server actions (C3 blind spot — unguarded actions go invisible)',
    file: 'src/ubg/nextjs.js',
    find: 'parseServerActions(abs);',
    repl: 'void abs;',
    test: 'tests/server-actions.test.js',
  },
  {
    desc: 'fastapi_extract: stop recognizing Flask @app.route (Flask routes disappear)',
    file: 'src/ubg/fastapi_extract.py',
    find: 'if attr == "route":',
    repl: 'if False:',
    test: 'tests/flask.test.js',
  },
  {
    desc: 'fastapi_extract: stop extracting Flask class-based views (CBV mutations go invisible)',
    file: 'src/ubg/fastapi_extract.py',
    find: 'self.collect_cbv(node.value, abs_file, prefix, modctx, rel_file,',
    repl: 'None and self.collect_cbv(node.value, abs_file, prefix, modctx, rel_file,',
    test: 'tests/flask-cbv.test.js',
  },
  {
    desc: 'translate: credit a scoped Next middleware on paths its matcher excludes (false PROVEN on /api)',
    file: 'src/ubg/translate.js',
    find: 'globalMiddlewares.filter((mw) => middlewareAppliesTo(mw, route))',
    repl: 'globalMiddlewares',
    test: 'tests/nextjs-matcher.test.js',
  },
  {
    desc: 'nestjs: stop reading principal-injection param decorators (twenty auth goes invisible again, ADR-063)',
    file: 'src/ubg/nestjs.js',
    find: 'const principalGuards = paramAuthGuards(m, mod).filter(',
    repl: 'const principalGuards = [].filter(',
    test: 'tests/param-auth-decorator.test.js',
  },
  {
    desc: 'extract: stop following request taint through destructuring (proof-grade O2 goes blind, ADR-064)',
    file: 'src/ubg/extract.js',
    find: 'if (key && local) map.set(local, `:${key}`);',
    repl: 'if (key && local) void 0;',
    test: 'tests/taint-flow.test.js',
  },
  {
    desc: 'strapi: stop unrolling createCoreRouter (the dominant CRUD idiom goes invisible, ADR-065)',
    file: 'src/ubg/strapi.js',
    find: 'const coreUid = coreRouterUid(exported);',
    repl: 'const coreUid = null;',
    test: 'tests/strapi.test.js',
  },
  {
    desc: 'strapi: give an auth:false public route the default-auth guard (hides an unguarded public mutation, ADR-065)',
    file: 'src/ubg/strapi.js',
    find: '      !r.authOptOut &&',
    repl: '      true &&',
    test: 'tests/strapi.test.js',
  },
  {
    desc: 'resolve: stop seeding taint across a helper-call boundary (interprocedural taint goes blind, ADR-066)',
    file: 'src/ubg/resolve.js',
    find: 'const calleeSeed = seedTaint(fn, node.arguments, callerReq, name);',
    repl: 'const calleeSeed = null;',
    test: 'tests/taint-flow.test.js',
  },
  {
    desc: 'extract: stop treating an unknown method on a proven DB handle as a write (opaque write goes invisible, ADR-068)',
    file: 'src/ubg/extract.js',
    find: '    handleReceiver &&',
    repl: '    false &&',
    test: 'tests/opaque-write.test.js',
  },
  {
    desc: 'apocalypse: stop counting an opaque persistence write toward the guard obligation (hidden hole, ADR-068)',
    file: 'src/ubg/apocalypse.js',
    find: "if (n.meta.opaque && n.meta.effectType === 'db_write' && outs.length === 0)",
    repl: 'if (false)',
    test: 'tests/opaque-write.test.js',
  },
  {
    desc: 'extract: verify express-jwt even with credentialsRequired:false (over-verifies a guard that passes anyone → false PROVEN, ADR-069)',
    file: 'src/ubg/extract.js',
    find: "return !objectOptionIsFalse(node.arguments[0], 'credentialsRequired');",
    repl: 'return true;',
    test: 'tests/auth-catalog.test.js',
  },
  {
    desc: 'apocalypse: let an asserted-only-guarded mutation still read PROVEN (the type-lock goes cosmetic → false PROVEN, ADR-070)',
    file: 'src/ubg/apocalypse.js',
    find: 'if (!guards.some((n) => n.meta.verified === true))',
    repl: 'if (false)',
    test: 'tests/type-lock.test.js',
  },
  {
    desc: 'nestjs: verify a passport subclass even when it overrides handleRequest (may swallow the 401 → false PROVEN, ADR-071)',
    file: 'src/ubg/nestjs.js',
    find: 'return !overridesDeny;',
    repl: 'return true;',
    test: 'tests/nest-passport.test.js',
  },
  {
    desc: 'apocalypse: hard-flag every observable incl. a generic fetch (autoimmunity → the O4 wolf-cry returns, ADR-072)',
    file: 'src/ubg/apocalypse.js',
    find: "const knownDangerous = String(obs.meta.target ?? '').startsWith('sdk:');",
    repl: 'const knownDangerous = true;',
    test: 'tests/immune-observable.test.js',
  },
  {
    desc: 'extract: stop reading the named status constant FORBIDDEN/UNAUTHORIZED as a deny (ADR-073)',
    file: 'src/ubg/extract.js',
    find: "(a.property.name === 'FORBIDDEN' || a.property.name === 'UNAUTHORIZED'));",
    repl: 'false);',
    test: 'tests/nest-status-const.test.js',
  },
  {
    desc: 'extract: drop the identity gate on the ownership-witness verifier — a req.body spoof-compare would clear a real BOLA (false discharge, ADR-074)',
    file: 'src/ubg/extract.js',
    find: "if (valueIsIdentity(b.right) && b.left?.type === 'MemberExpression') owns = true;",
    repl: "if (true && b.left?.type === 'MemberExpression') owns = true;",
    test: 'tests/bola-witness.test.js',
  },
  {
    desc: 'extract: drop the call-site identity gate on the INTERPROCEDURAL witness — every arg reads as identity, so a req.body spoof handed to a helper would clear a real BOLA (ADR-074 V2)',
    file: 'src/ubg/extract.js',
    find: 'if (valueIsIdentity(arg)) identityParams.add(name);',
    repl: 'if (true) identityParams.add(name);',
    test: 'tests/bola-witness-helper.test.js',
  },
  {
    desc: 'extract: drop the deny requirement on the interprocedural witness helper body — a helper that only LOGS the mismatch would clear a real BOLA (ADR-074 V2)',
    file: 'src/ubg/extract.js',
    find: "if (node.type !== 'IfStatement' || !branchDenies(node.consequent)) return;",
    repl: "if (node.type !== 'IfStatement') return;",
    test: 'tests/bola-witness-helper.test.js',
  },
  {
    desc: 'witness: admit every generator hint without re-proving it (trust the LLM → a fabricated location clears a real BOLA, ADR-074 generator)',
    file: 'src/ubg/witness.js',
    find: 'const check = verifyWitnessAt(appDir, hint.file, hint.line);',
    repl: "const check = { verified: true, via: 'inline-compare' };",
    test: 'tests/witness.test.js',
  },
  {
    desc: 'witness: drop the attribution tether — a real check the route never reaches clears its advisory (ADR-074 generator)',
    file: 'src/ubg/witness.js',
    find: 'if (hintAbs === epAbs) return true;',
    repl: 'if (true) return true;',
    test: 'tests/witness.test.js',
  },
  {
    desc: 'enforce: dissolve the court — an edit that cannot prove itself persists anyway (a counterfeit check buys green, ADR-076)',
    file: 'src/commands/enforce.js',
    find: "  if (\n    after.state !== 'PROVEN' ||\n    stillAsserted > 0 ||\n    grewFindings ||\n    proofFailed ||\n    blockedRoutes.length > 0\n  ) {",
    repl: 'if (false) {',
    test: 'tests/enforce.test.js',
  },
  {
    desc: 'enforce: the synthesized shim stops denying — the court must refuse it, so PARTIAL never turns PROVEN (ADR-076)',
    file: 'src/commands/enforce.js',
    find: "body ??\n      `  if (!${principal}) return res.status(401).json({ error: 'unauthorized' });`,",
    repl: 'body ?? `  void ${principal};`,',
    test: 'tests/enforce.test.js',
  },
  {
    desc: 'enforce: disclosure stops following the bytes — a hand-stripped shim still reads as ENFORCED (ADR-076)',
    file: 'src/commands/enforce.js',
    find: 'if (sha(cur) !== rec.enforcedSha256 || !cur.includes(MARK_START)) return null;',
    repl: 'if (false) return null;',
    test: 'tests/enforce.test.js',
  },
  {
    desc: 'falsify: ablate by DELETION instead of contraction — the handler goes unreachable and "clean" masquerades as flipped-check passing (ADR-077)',
    file: 'src/ubg/falsify.js',
    find: "bridged.push({ from: p.from, to: s.to, kind: 'control_flow', meta: p.meta });",
    repl: 'void s;',
    test: 'tests/falsify.test.js',
  },
  {
    desc: 'falsify: report every control as flipped without consulting the verifier — a blind checker would pass its own audit (ADR-077)',
    file: 'src/ubg/falsify.js',
    find: 'flipped: after.has(t.id) && !before.has(t.id),',
    repl: 'flipped: true,',
    test: 'tests/falsify.test.js',
  },
  {
    desc: 'falsify: stop unfolding the flood-collapsed row — every real-world flip goes invisible and healthy apps read as full of holes (ADR-077)',
    file: 'src/ubg/falsify.js',
    find: 'for (const ep of f.evidence ?? []) set.add(ep);',
    repl: ';',
    test: 'tests/falsify.test.js',
  },
  {
    desc: 'translate: ignore declaration order — a use(auth) declared AFTER a route guards it again (E-061 false PROVEN)',
    file: 'src/ubg/translate.js',
    find: 'if (mw.order > route.order) return false;',
    repl: '',
    test: 'tests/sequential-order.test.js',
  },
  {
    desc: 'express: flatten if-branches as unconditional again — a conditional surface reads 100% active (E-062)',
    file: 'src/ubg/express.js',
    find: "case 'IfStatement':\n        push(blockOf(s.consequent), depth, true);\n        push(blockOf(s.alternate), depth, true);",
    repl: "case 'IfStatement':\n        push(blockOf(s.consequent), depth, conditional);\n        push(blockOf(s.alternate), depth, conditional);",
    test: 'tests/conditional-surface.test.js',
  },
  {
    desc: 'blindspots: 0/0 coverage reads 100% again — the absence of a measurement becomes a perfect score (E-064)',
    file: 'src/ubg/blindspots.js',
    find: 'ratio: denom === 0 ? null : Math.round((resolved / denom) * 1000) / 1000,',
    repl: 'ratio: denom === 0 ? 1 : Math.round((resolved / denom) * 1000) / 1000,',
    test: 'tests/coverage-unknown.test.js',
  },
  {
    desc: 'express: silence dynamic registrations again — app[v](…) vanishes without an UnknownHandler (E-063)',
    file: 'src/ubg/express.js',
    find: "unknownRegistration('computed-method', callee.object.name, expr);",
    repl: "if (false) unknownRegistration('computed-method', callee.object.name, expr);",
    test: 'tests/dynamic-registration.test.js',
  },
  {
    desc: 'express: forget app.all — an unguarded all-verb endpoint goes invisible again (Z1 false PROVEN)',
    file: 'src/ubg/express.js',
    find: "        if (method === 'all') {",
    repl: "        if (false && method === 'all') {",
    test: 'tests/zero-day-verbs.test.js',
  },
  {
    desc: 'express: forget the chainable Route API — app.route().post() vanishes again (Z1)',
    file: 'src/ubg/express.js',
    find: 'const routeChain = routeChainOf(expr, expressObjects);',
    repl: 'const routeChain = null;',
    test: 'tests/zero-day-verbs.test.js',
  },
  {
    desc: 'express: drop an unmodelled member silently instead of declaring it (kills the structural invariant)',
    file: 'src/ubg/express.js',
    find: 'unknownRegistration(`unmodelled-member:${method}`, objName, expr);',
    repl: ';',
    test: 'tests/registration-invariant.test.js',
  },
  {
    desc: 'express: stop following app/router aliases — const api = app hides its routes again (Z2)',
    file: 'src/ubg/express.js',
    find: "    if (d.init.type === 'Identifier') {",
    repl: "    if (false && d.init.type === 'Identifier') {",
    test: 'tests/zero-day-alias.test.js',
  },
  {
    desc: 'express: trust every called factory instead of its official package binding',
    file: 'src/ubg/express.js',
    find: 'const kind = factoryKindOf(d.init);',
    repl: "const kind = d.init?.type === 'CallExpression' ? 'app' : null;",
    test: 'tests/express-binding-provenance.test.js',
  },
  {
    desc: 'express: silently discard a registration through a reassigned app binding',
    file: 'src/ubg/express.js',
    find: 'if (ambiguousReceiver) {',
    repl: 'if (false && ambiguousReceiver) {',
    test: 'tests/express-binding-provenance.test.js',
  },
  {
    desc: 'blindspots: score a lost file medium again — a parse error stops barring PROVEN (Z3)',
    file: 'src/ubg/blindspots.js',
    find: "isFatalSkip(reason) ? 'high' : MUTATING_VERB.test(reason) ? 'high' : 'medium'",
    repl: "MUTATING_VERB.test(reason) ? 'high' : 'medium'",
    test: 'tests/zero-day-effects.test.js',
  },
  {
    desc: 'extract: bail out on a computed member again — prisma.note[OP]() stops being a write (Z4)',
    file: 'src/ubg/extract.js',
    find: '  if (dynamicMember) {\n    opaqueDynamicWrite(node, out, ctx, callee, line);',
    repl: '  if (false) {\n    opaqueDynamicWrite(node, out, ctx, callee, line);',
    test: 'tests/zero-day-effects.test.js',
  },
  {
    desc: 'translate: credit a path-scoped middleware everywhere — the Express matcher sin returns (Z6)',
    file: 'src/ubg/translate.js',
    find: 'if (mw.pathPrefix && !pathCoveredBy(mw.pathPrefix, route.path)) return false;',
    repl: '',
    test: 'tests/zero-day-effects.test.js',
  },
  {
    desc: 'express: treat a pathed callable as middleware only — a terminal handler at a path vanishes again (C3)',
    file: 'src/ubg/express.js',
    find: "        if (role === 'handler') {",
    repl: '        if (false) {',
    test: 'tests/zero-day-pathed-handler.test.js',
  },
  {
    desc: 'express: call next() detection always true — every pathed handler is misread as middleware (C3)',
    file: 'src/ubg/express.js',
    find: '  if (!nextParam) return false;',
    repl: '  if (!nextParam) return true;',
    test: 'tests/zero-day-pathed-handler.test.js',
  },
  {
    desc: 'express: read a local function as an unresolved router mount again (loses the callable entirely)',
    file: 'src/ubg/express.js',
    find: '    if (mod.functions?.has(arg.name)) return undefined;',
    repl: '    if (false) return undefined;',
    test: 'tests/zero-day-pathed-handler.test.js',
  },
  {
    desc: 'extract: drop optional-chained calls again — prisma?.note?.deleteMany() goes invisible',
    file: 'src/ubg/extract.js',
    find: "  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {",
    repl: "  if (node.type === 'CallExpression') {",
    test: 'tests/dynamic-effects.test.js',
  },
  {
    desc: 'extract: stop reading tagged-template SQL — prisma.$executeRaw`DELETE …` goes invisible',
    file: 'src/ubg/extract.js',
    find: '    taggedTemplateEffect(node, out, ctx);',
    repl: '    void node;',
    test: 'tests/dynamic-effects.test.js',
  },
  {
    desc: 'extract: ignore a proven handle hiding in an unnameable receiver ((a?b:c).wipe() goes invisible)',
    file: 'src/ubg/extract.js',
    find: '  const root = rootIdentifier(callee) ?? handleInSubtree(callee, ctx.dbHandles);',
    repl: '  const root = rootIdentifier(callee);',
    test: 'tests/dynamic-effects.test.js',
  },
  {
    desc: 'translate: ignore intra-file order — a router.use(auth) at the bottom guards the routes above it',
    file: 'src/ubg/translate.js',
    find: '      mw.orderIn > route.orderIn',
    repl: '      false',
    test: 'tests/router-use-order.test.js',
  },
  {
    desc: 'nestjs: forget @All again — an unguarded all-verb Nest endpoint goes invisible (the Nest twin of E-067)',
    file: 'src/ubg/nestjs.js',
    find: "const verbs = http.method === 'all' ? NEST_ALL_EXPANSION : [http.method];",
    repl: 'const verbs = [http.method];',
    test: 'tests/cross-framework-verbs.test.js',
  },
  {
    desc: 'translate: read every non-GET verb as a mutation — CORS pre-flight handlers become false criticals',
    file: 'src/ubg/translate.js',
    find: 'mutating: !SAFE_METHOD.has(route.method.toLowerCase()),',
    repl: "mutating: route.method !== 'get',",
    test: 'tests/cross-framework-verbs.test.js',
  },
  {
    desc: 'nestjs: silently mount a dynamic decorator path at the prefix instead of declaring it',
    file: 'src/ubg/nestjs.js',
    find: '          if (http.pathDynamic) {',
    repl: '          if (false) {',
    test: 'tests/cross-framework-verbs.test.js',
  },
  {
    desc: 'apocalypse: let a measured premise gap keep the PROVEN word (the oracle stops gating)',
    file: 'src/ubg/apocalypse.js',
    find: '  const premiseUnverified = premiseGaps > 0;',
    repl: '  const premiseUnverified = false;',
    test: 'tests/premise-gate.test.js',
  },
  {
    desc: 'premise: treat an empty probe as a clean bill of health (a broken oracle would confirm every proof)',
    file: 'src/ubg/premise.js',
    find: '  if (!Array.isArray(probed) || probed.length === 0)',
    repl: '  if (false)',
    test: 'tests/premise-gate.test.js',
  },
  {
    desc: 'nextjs: stop declaring the handlers under an inexpressible segment (the subtree vanishes again)',
    file: 'src/ubg/nextjs.js',
    find: '          declareUnrouted(abs, `under catch-all segment ${name}`);',
    repl: '          if (false) declareUnrouted(abs, `under catch-all segment ${name}`);',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'nextjs: swallow an unparseable global middleware (every route below reads ungated, silently)',
    file: 'src/ubg/nextjs.js',
    find: '    if (mod.error) {\n      // The middleware file IS',
    repl: '    if (false) {\n      // The middleware file IS',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'medusa: drop a verb export whose handler did not resolve (a served route leaves no trace)',
    file: 'src/ubg/medusa.js',
    find: '      if (!fn) {',
    repl: '      if (!fn) {\n        continue;',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'strapi: stop declaring a route whose controller never resolved (an unread mutation reads resolved)',
    file: 'src/ubg/strapi.js',
    find: '        if (!controllerFn && def.handler && !def.defaultVerb) {',
    repl: '        if (false) {',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'openapi: skip a path-item member the lowering does not model (published surface disappears)',
    file: 'src/ubg/openapi.js',
    find: "      if (VERBS.has(key) || NON_OPERATION.has(key) || key.startsWith('x-')) continue;",
    repl: '      if (true) continue;',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'fastapi: drop a decorator whose path is not a literal (a live endpoint leaves no trace)',
    file: 'src/ubg/fastapi_extract.py',
    find: '            if not isinstance(raw_path, str):',
    repl: '            if not isinstance(raw_path, str) and False:',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    // anti-vacuity: an enumerator that quietly stops matching turns the whole fleet
    // certificate green by finding nothing to check. The corpus-total guard must bite.
    desc: 'the fleet certificate: blind one of its independent enumerators (a sweep that finds nothing passes)',
    file: 'tests/no-silent-loss-fleet.test.js',
    find: 'const CLASS_DECORATOR = /(^|[a-z])Controller$|^Resolver$/;',
    repl: 'const CLASS_DECORATOR = /^__never__$/;',
    test: 'tests/no-silent-loss-fleet.test.js',
  },
  {
    desc: 'oracle-static: stop enumerating the Pages Router (a whole second routing system goes unclaimed)',
    file: 'src/ubg/oracle-static.js',
    find: '  const pagesRoutes = pagesApiRoutes(cwd);',
    repl: '  const pagesRoutes = [];',
    test: 'tests/premise-convention.test.js',
  },
  {
    desc: 'premise: read an empty convention enumeration as verified (a silent oracle confirms every proof)',
    file: 'src/ubg/premise.js',
    find: '  if (candidate.length === 0)',
    repl: '  if (false)',
    test: 'tests/premise-convention.test.js',
  },
  {
    desc: 'premise: stop suppressing already-declared surface (every unknown handler double-counts as a gap)',
    file: 'src/ubg/premise.js',
    find: '  const candidate = oracle.routes.filter(\n    (r) => !declared.has(`${r.file}::${r.method.toUpperCase()}`),\n  );',
    repl: '  const candidate = oracle.routes;',
    test: 'tests/premise-convention.test.js',
  },
  {
    desc: 'nextjs: filter `app/dist` as build output again — a served URL segment goes invisible on all three channels',
    file: 'src/ubg/nextjs.js',
    find: "const EXCLUDE = new Set(['node_modules', '.git', '.next', '.sparda']);",
    repl: "const EXCLUDE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.sparda']);",
    test: 'tests/premise-convention.test.js',
  },
  {
    desc: 'apocalypse: unplug the premise from the CI gate (a tree with unseen routes ships again)',
    file: 'src/commands/apocalypse.js',
    find: '    premiseGaps: premise.available ? premise.gaps.length : 0,',
    repl: '    premiseGaps: 0,',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'badge: render a premise gap as a finding count again ("0 findings" on the public artifact)',
    file: 'src/ubg/apocalypse.js',
    find: "          ? 'premise not verified'",
    repl: '          ? `${c.critical + c.high} findings`',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'review: grade the graph and ignore the candidate report (declared surface vanishes from the PR gate)',
    file: 'src/commands/review.js',
    find: '    candidateReport ? withPremiseGaps(candidateReport, premise) : undefined,',
    repl: '    undefined,',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'premise: let the shared helper skip the convention oracle (every gate silently stops asking)',
    file: 'src/ubg/premise.js',
    find: '    FREE_ORACLE.has(report.framework) || (probe && PROBEABLE.has(report.framework));',
    repl: '    probe && PROBEABLE.has(report.framework);',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'stdio: the MCP tool grades without the premise again (the agent gets a word the CLI would refuse)',
    file: 'src/server/stdio.js',
    find:
      '    premiseGaps: premise.available ? premise.gaps.length : 0,\n' +
      '    premiseBasis: basisFrom(premise),\n' +
      '  });\n  return {\n    verdict: verdictState(verdict),',
    repl: '  });\n  return {\n    verdict: verdictState(verdict),',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'corpus-oracle: grade the giants with no premise check (the pre-ADR-083 state that let a PROVEN stand on unseen surface)',
    file: 'scripts/corpus-oracle.mjs',
    find: "  const premise = await certifiableOrgan('corpus-oracle').premise(g, report, {\n    cwd: appDir,\n  });",
    repl: '  const premise = { available: false, gaps: [], probed: 0 };',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'nestjs: stop resolving composite decorators (340 novu guards go back to name-only trust, ADR-084)',
    file: 'src/ubg/nestjs.js',
    find: '      const c = resolveCompositeDecorator(name, mod, compositeCache);',
    repl: '      const c = null;',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: resolve a composite against the CONTROLLER instead of its declaring module (renames, proves nothing)',
    file: 'src/ubg/nestjs.js',
    find: '      for (const g of c.guards) push(g, c.mod ?? mod);',
    repl: '      for (const g of c.guards) push(g, mod);',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: drop a SetMetadata tag even when a PROVEN global guard reads it (deletes immich auth)',
    file: 'src/ubg/nestjs.js',
    find: '      if (c.metadataOnly && !globalGuardDenies) {',
    repl: '      if (c.metadataOnly) {',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: swallow the unread branch of a conditional composite (a claim about a config nobody opened)',
    file: 'src/ubg/nestjs.js',
    find: '      unread.push(shortSrc(ret));\n    }\n    if (!sawReadable',
    repl: '      void shortSrc(ret);\n    }\n    if (!sawReadable',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: stop following a barrel re-export (a whole workspace package of decorators goes unread)',
    file: 'src/ubg/nestjs.js',
    find: '      for (const star of dmod.starReexports ?? []) {',
    repl: '      for (const star of []) {',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: pre-filter on a fixed decorator vocabulary again (twenty drops 579 routes to 147, ADR-085)',
    file: 'src/ubg/nestjs.js',
    find: '  /@(?:[A-Za-z]*Controller|[A-Za-z]*Resolver|(?:Http)?(?:Get|Post|Put|Patch|Delete|Options|Head|All)(?:Mapping)?)\\b/;',
    repl: '  /@(?:Controller|Resolver|(?:Http)?(?:Get|Post|Put|Patch|Delete|Options|Head|All)(?:Mapping)?)\\b/;',
    test: 'tests/nest-custom-resolver.test.js',
  },
  {
    desc: "nestjs: match the resolver brand by exact name (54 of twenty's 55 resolvers go unread)",
    file: 'src/ubg/nestjs.js',
    find: '    if (!name || !/resolver$/i.test(name)) continue;',
    repl: "    if (name !== 'Resolver') continue;",
    test: 'tests/nest-custom-resolver.test.js',
  },
  {
    desc: 'nestjs: read only the FIRST element of an array path (a live endpoint lost in silence)',
    file: 'src/ubg/nestjs.js',
    find: '            ? http.paths.map((pp) => joinPath(prefix, pp))',
    repl: '            ? [joinPath(prefix, http.paths[0])]',
    test: 'tests/nest-custom-resolver.test.js',
  },
  {
    desc: 'nestjs: treat an array path as unreadable again (four webhook controllers collapse onto POST /)',
    file: 'src/ubg/nestjs.js',
    find: "      pathArg?.type === 'ArrayExpression' ? pathArg.elements.filter(Boolean) : null;",
    repl: '      null;',
    test: 'tests/nest-custom-resolver.test.js',
  },
  {
    desc: "apocalypse: report one irreversible finding per effect NODE again (12 of twenty's 28 highs were one route)",
    file: 'src/ubg/apocalypse.js',
    find: '        (knownDangerous ? dangerous : generic).push(obs);',
    repl: "        (knownDangerous ? dangerous : generic).push(obs);\n        findings.push({ rule: 'IRREVERSIBLE_OBSERVABLE', severity: knownDangerous ? 'high' : 'info', entrypoint: ep.id, message: 'x', evidence: [] });",
    test: 'tests/irreversible-per-route.test.js',
  },
  {
    desc: "apocalypse: collapse a route's generic calls into a HARD finding (an advisory promoted to a gate)",
    file: 'src/ubg/apocalypse.js',
    find: '        const hard = dangerous.length > 0;',
    repl: '        const hard = true;',
    test: 'tests/irreversible-per-route.test.js',
  },
  {
    desc: 'apocalypse: drop the collapsed calls from the evidence (the fan-out becomes unauditable)',
    file: 'src/ubg/apocalypse.js',
    find: '          evidence: flagged.map((o) => `${o.id} (${locOf(o)})`).sort(),',
    repl: '          evidence: [],',
    test: 'tests/irreversible-per-route.test.js',
  },
  {
    desc: 'resolve: stop crossing barrels for classes (every DI hop into a workspace package dies silently)',
    file: 'src/ubg/resolve.js',
    find: '    const hit = resolveExportedClass(clsMod, className);',
    repl: '    const hit = null;',
    test: 'tests/nest-barrel-di.test.js',
  },
  {
    desc: 'extract: stop following `export * from` when hunting a class (the barrel becomes a wall again)',
    file: 'src/ubg/extract.js',
    find: '  for (const file of mod.starReexports ?? []) {\n    if (seen.has(file)) continue;\n    seen.add(file);\n    const hit = resolveExportedClass(parseModule(file), name, seen);',
    repl: '  for (const file of []) {\n    if (seen.has(file)) continue;\n    seen.add(file);\n    const hit = resolveExportedClass(parseModule(file), name, seen);',
    test: 'tests/nest-barrel-di.test.js',
  },
  {
    desc: 'falsify: score 1 when NOTHING was falsified (a perfect number for a run that checked nothing)',
    file: 'src/ubg/falsify.js',
    find: '      score: null,',
    repl: '      score: 1,',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'immunity: a portable capsule claims proven over an unmeasured premise (the word travels without its licence)',
    file: 'src/ubg/immunity.js',
    find: '    proven: premiseUnmeasured && provenByPol ? null : provenByPol,',
    repl: '    proven: provenByPol,',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'gate: report ok:true when it ABSTAINED (a check that never ran reads as a pass)',
    file: 'src/commands/gate.js',
    find: '      console.log(JSON.stringify({ ok: null, abstained: err.message }, null, 2));',
    repl: '      console.log(JSON.stringify({ ok: true, abstained: err.message }, null, 2));',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'apocalypse: let an UNMEASURED premise read as PROVEN again (E-104 — the forbidden equality)',
    file: 'src/ubg/apocalypse.js',
    find: "  const premiseUnmeasured = premiseBasis === 'unmeasured';",
    repl: '  const premiseUnmeasured = false;',
    test: 'tests/prove.test.js',
  },
  {
    desc: 'premise: label an absent oracle "measured" (an honest state erased at the source)',
    file: 'src/ubg/premise.js',
    find: "  if (framework === 'openapi') return 'declared';\n  return 'unmeasured';",
    repl: "  if (framework === 'openapi') return 'declared';\n  return 'measured';",
    test: 'tests/prove.test.js',
  },
  {
    desc: 'prove: stop naming the premise as the reason (PARTIAL at 100% coverage with no cause given)',
    file: 'src/commands/prove.js',
    find: '    if (verdict.premiseUnmeasured)\n      reasons.unshift(',
    repl: '    if (false)\n      reasons.unshift(',
    test: 'tests/prove.test.js',
  },
  {
    desc: 'prove: let a positive PDE diagnosis upgrade the public verdict (diagnostic-only boundary breaks)',
    file: 'src/commands/prove.js',
    find: '    verdict: state,',
    repl: "    verdict: pde.status === 'proven' ? 'PROVEN' : state,",
    test: 'tests/prove.test.js',
  },
  {
    desc: 'vscode: offer "Install sparda-mcp" for ANY failure (a wrong remedy delivered with a button)',
    file: 'extensions/vscode/src/lib.cjs',
    find: "  if (!cli || cli.source !== 'npx') return false;",
    repl: '  if (!cli) return false;',
    test: 'tests/vscode-extension.test.js',
  },
  {
    desc: 'vscode: install sparda-mcp GLOBALLY (the proving version stops being the pinned one)',
    file: 'extensions/vscode/src/lib.cjs',
    find: "  return { cmd: 'npm i -D sparda-mcp', from: null };",
    repl: "  return { cmd: 'npm i -g sparda-mcp', from: null };",
    test: 'tests/vscode-extension.test.js',
  },
  {
    desc: 'vscode: let the lightbulb offer enforce on an OWNERSHIP finding (a check that cannot fix it)',
    file: 'extensions/vscode/src/lib.cjs',
    find: "const ENFORCEABLE = new Set(['UNGUARDED_MUTATION']);",
    repl: "const ENFORCEABLE = new Set(['UNGUARDED_MUTATION', 'OBJECT_SCOPE_UNPROVEN']);",
    test: 'tests/vscode-extension.test.js',
  },
  {
    desc: 'release: put `prepublishOnly` back to a bare `vitest run` (the exact hook that let 0.69.0 out)',
    file: 'package.json',
    find: '"prepublishOnly": "node scripts/release-gate.mjs"',
    repl: '"prepublishOnly": "vitest run"',
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'release-checks: stop comparing HEAD to origin/main (a release cut mid-flight passes again — 0.69.0 exactly)',
    file: 'scripts/release-checks.mjs',
    find: '  if (head !== remote)',
    repl: '  if (false)',
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'release-checks: read an unreachable npm registry as "version absent" (unmeasured counted as a pass)',
    file: 'scripts/release-checks.mjs',
    find: "    if (status === 404) return { state: 'ok' };\n    return { state: 'unverified' };",
    repl: "    return { state: 'ok' };",
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'release-checks: drop the VS Code manifest from the list (the one artefact that ships OUTSIDE the gate)',
    file: 'scripts/release-checks.mjs',
    find: "  ['extensions/vscode/package.json', ['version']],",
    repl: '',
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'release-checks: check only the first version field of server.json (a half-bump ships)',
    file: 'scripts/release-checks.mjs',
    find: "  ['server.json', ['version', 'packages.0.version']],",
    repl: "  ['server.json', ['version']],",
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'release-gate: add an env escape hatch (the one release that skips the gate is the one that needed it)',
    file: 'scripts/release-gate.mjs',
    find: 'const failures = [];',
    repl: 'const failures = [];\nif (process.env.SKIP_GATE) process.exit(0);',
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'nestjs: let a non-guard forRoutes middleware attach anyway (a LoggerMiddleware softens a real hole)',
    file: 'src/ubg/nestjs.js',
    find: 'if (!proven && !(GUARD_DECORATOR.test(name) || nameLooksLikePrincipal(name)))\n        continue;',
    repl: 'if (false) continue;',
    test: 'tests/nest-forroutes-middleware.test.js',
  },
  {
    desc: 'nestjs: fabricate the forRoutes deny-proof (every bound middleware reads as a proven denier)',
    file: 'src/ubg/nestjs.js',
    find: 'return Boolean(scan.guardSignals?.deniesWithStatus);',
    repl: 'return true;',
    test: 'tests/nest-forroutes-middleware.test.js',
  },
  {
    desc: 'nestjs: ignore the forRoutes method (a POST binding covers the DELETE — cross-verb over-cover)',
    file: 'src/ubg/nestjs.js',
    find: "      (target.method === 'all' || target.method === verb) &&",
    repl: '      (true) &&',
    test: 'tests/nest-forroutes-middleware.test.js',
  },
  {
    desc: 'nestjs: let a literal forRoutes path over-cover a different literal route (strict-path invariant)',
    file: 'src/ubg/nestjs.js',
    find: 'if (ts !== rs) return false; // literal vs literal',
    repl: 'if (false) return false; // literal vs literal',
    test: 'tests/nest-forroutes-middleware.test.js',
  },
  {
    desc: 'release-checks: stop verifying the tag is pushed to origin (a local-only tag passes again)',
    file: 'scripts/release-checks.mjs',
    find: '  if (!localShas.has(remoteAt))',
    repl: '  if (false)',
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'release-checks: let a detached HEAD pass without being origin/main (a tag build of ANY commit publishes)',
    file: 'scripts/release-checks.mjs',
    find: "  if (branch !== 'main' && !(branch === 'HEAD' && atMainTip))",
    repl: "  if (branch !== 'main' && !(branch === 'HEAD'))",
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'release-checks: report an unreachable origin as an un-pushed tag (rule 13 — could-not-ask told as a measurement)',
    file: 'scripts/release-checks.mjs',
    find: '  if (!remoteReachable)',
    repl: '  if (false)',
    test: 'tests/release-gate.test.js',
  },
  {
    desc: 'detect: lose the search marker when recursing (a Flask entry in a subdirectory becomes the FastAPI file, silently — E-115)',
    file: 'src/detect.js',
    find: '      const found = searchPyFiles(abs, root, countRef, marker);',
    repl: '      const found = searchPyFiles(abs, root, countRef);',
    test: 'tests/flask-nested-entry.test.js',
  },
  // ── E-109: the runtime oracle was inert on every ESM Express app ───────────────────
  {
    desc: 'shim: stop pre-loading express for ESM entries (Module._load never fires on an import → premise stays unmeasured forever)',
    file: 'src/probe/express-shim.cjs',
    find: "      appRequire('express'); // goes through Module._load → sets `patched`, runs patchExpress",
    repl: '      void appRequire;',
    test: 'tests/probe.test.js',
  },
  {
    desc: 'probe: blame the app again when it was SPARDA that could not look (wrong diagnosis, rule 13)',
    file: 'src/probe/probe.js',
    find: "      state: 'not-instrumented',",
    repl: "      state: 'did-not-start',",
    test: 'tests/probe.test.js',
  },
  {
    desc: "probe: throw the target's own stderr away again (a boot failure with no stated cause)",
    file: 'src/probe/probe.js',
    find: '      if (stderrTail.length < 4000) stderrTail += String(chunk);',
    repl: '      void chunk;',
    test: 'tests/probe.test.js',
  },
  {
    desc: 'shim: emit a route at registration instead of after mounting (a mounted router reports its bare declared path → false premise gaps, E-110)',
    file: 'src/probe/express-shim.cjs',
    find: '          stage(this, verb, path);',
    repl: "          sendMsg({ type: 'route', method: verb, path });",
    test: 'tests/probe.test.js',
  },
  {
    desc: 'shim: stop recording where a router was MOUNTED (every sub-route loses its prefix)',
    file: 'src/probe/express-shim.cjs',
    find: '            mounts.push({ parent: this, child: h, path: mountPath });',
    repl: '            void h;',
    test: 'tests/probe.test.js',
  },
  // ── E-106: the ADR-092 fix existed and no call site reached it ─────────────────────
  {
    desc: 'premise: a consumer that never measured defaults to "measured" (E-106 — fail toward the stronger word)',
    file: 'src/ubg/premise.js',
    find: "  if (premise?.available) return 'measured';\n  return premise?.basis ?? 'unmeasured';",
    repl: "  if (premise?.available) return 'measured';\n  return premise?.basis ?? 'measured';",
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'immunize: build the capsule with no basis again (the portable proof stops carrying its licence)',
    file: 'src/commands/immunize.js',
    find: '  const capsule = buildCapsule(canonical, { premiseBasis: basisFrom(premise) });',
    repl: '  const capsule = buildCapsule(canonical);',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'immunize: gate CI on a falsy `proven` (fail a build because no oracle was AVAILABLE)',
    file: 'src/commands/immunize.js',
    find: '  if (capsule.proven === false && !capsule.surfaceOnly) process.exitCode = 1;',
    repl: '  if (!capsule.proven && !capsule.surfaceOnly) process.exitCode = 1;',
    test: 'tests/command-smoke.test.js',
  },
  {
    desc: 'capsule: blank a real NOT-PROVEN to null when the premise is unmeasured (loses a finding in the unsafe direction)',
    file: 'src/ubg/immunity.js',
    find: '    proven: premiseUnmeasured && provenByPol ? null : provenByPol,',
    repl: '    proven: premiseUnmeasured ? null : provenByPol,',
    test: 'tests/command-smoke.test.js',
  },
  {
    desc: 'genome: sign and ship a contribution without ever asking for the premise (rule 11, on the artifact that TRAVELS)',
    file: 'src/commands/genome.js',
    find: '  const capsule = buildCapsule(canonical, { premiseBasis: basisFrom(premise) });',
    repl: '  const capsule = buildCapsule(canonical);',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'stitch: swallow a service that did not compile (a half join reports "nothing found")',
    file: 'src/commands/stitch.js',
    find: '      unread.push({ dir: d, reason: e.message.slice(0, 140) });',
    repl: '      console.error(`  ✗ ${d}: ${e.message.slice(0, 70)}`);',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'heal: claim "zero protection lost" with no baseline to diff against',
    file: 'src/commands/heal.js',
    find: '  const deltaMeasured = fs.existsSync(baselinePath);',
    repl: '  const deltaMeasured = true;',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'timeless: report "zero divergence" over a flight that recorded zero taps (falsify\'s empty-control-set bug, relocated)',
    file: 'src/commands/timeless.js',
    find: '    if (!flight.taps.length)',
    repl: '    if (false)',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: "resolve: drop the declaring file, so a DI-resolved effect is located in the route's file (E-099)",
    file: 'src/ubg/resolve.js',
    find: '  if (file) for (const e of scan.effects) e.file ??= file;',
    repl: '  if (false) for (const e of scan.effects) e.file ??= file;',
    test: 'tests/effect-location-follows-the-body.test.js',
  },
  {
    desc: 'translate: locate an effect by its owner instead of by the body that produced it (E-099)',
    file: 'src/ubg/translate.js',
    find: '    const effFile = eff.file ?? owner.loc.file;',
    repl: '    const effFile = owner.loc.file;',
    test: 'tests/effect-location-follows-the-body.test.js',
  },
  {
    desc: 'prove: report a count without naming the file it counted (E-117 — a JSON consumer reads routes:0 as a fact about the app)',
    file: 'src/commands/prove.js',
    find: '    entry: report.entry,',
    repl: '    entry: undefined,',
    test: 'tests/a-count-names-what-it-counted.test.js',
  },
  {
    desc: 'prove: a zero-route verdict stops naming the file that produced the zero (E-117)',
    file: 'src/commands/prove.js',
    find: '    console.log(`  ◦ analysed as ${report.framework}, entry: ${report.entry}`);',
    repl: '    if (false) console.log(`  ◦ analysed as ${report.framework}`);',
    test: 'tests/a-count-names-what-it-counted.test.js',
  },
  {
    desc: 'Fabric F1: let a pipeline pass drop a graph fact without classifying the loss',
    file: 'src/ubg/conservation.js',
    find: "    throw new Error(\n      `Fabric conservation violation in ${result.name ?? 'pipeline pass'}: ${fact.id} disappeared without classification`,\n    );",
    repl: '    continue;',
    test: 'tests/conservation.test.js',
  },
  {
    desc: 'Fabric F2: let parsed-but-unclaimed structural surface vanish instead of becoming unmeasured',
    file: 'src/ubg/compile.js',
    find: '  const structuralSkips = semanticCoverage.unmeasured',
    repl: '  const structuralSkips = []',
    test: 'tests/structural-coverage.test.js',
  },
  {
    desc: 'Fabric F3: let a certifiable organ bypass premiseFor and fabricate a measured premise',
    file: 'src/ubg/premise.js',
    find: '      return premiseFor(graph, report, options);',
    repl: "      return { available: true, basis: 'measured', gaps: [], probed: 0 };",
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'Fabric F4: hide a competing entry candidate after selecting an ambiguous boundary',
    file: 'src/detect.js',
    find: '    alternativeCandidates: alternatives,',
    repl: '    alternativeCandidates: [],',
    test: 'tests/detect-evidence.test.js',
  },
  {
    desc: 'Fabric F5: count a present-but-decorative enforcement guard as constraining',
    file: 'src/commands/enforce.js',
    find: '      scoped &&\n      deniedPath,',
    repl: '      true,',
    test: 'tests/enforce.test.js',
  },
  // ---- Node Semantic Kernel (first slice) ----
  {
    desc: 'kernel: drop the captured-scope instance lookup (the whole DAO layer goes invisible again)',
    file: 'src/ubg/resolve.js',
    find: "          : obj.type === 'Identifier' && captured.instance(obj.name)\n            ? captured.instance(obj.name)",
    repl: '          : false\n            ? null',
    test: 'tests/node-kernel.test.js',
  },
  {
    desc: 'kernel: stop reading captured Mongo collection handles (a real write leaves no effect)',
    file: 'src/ubg/kernel/bindings.js',
    find: '    const collection = collectionHandleOf(init);\n    if (collection) {',
    repl: '    const collection = null;\n    if (collection) {',
    test: 'tests/node-kernel.test.js',
  },
  {
    desc: 'kernel: invent a collection name when the argument is not a literal (fabricated target)',
    file: 'src/ubg/kernel/bindings.js',
    find: "  return { store: 'mongo', table: null, line, symbolic: true };",
    repl: "  return { store: 'mongo', table: 'unknown', line, symbolic: false };",
    test: 'tests/kernel-symbolic-target.test.js',
  },
  {
    desc: 'kernel: credit a guard without a proven deny path (a decorative next() becomes a gate)',
    file: 'src/ubg/kernel/facts.js',
    find: '    denyPathProven: Boolean(denyPathProven),',
    repl: '    denyPathProven: true,',
    test: 'tests/node-kernel.test.js',
  },
  {
    desc: 'kernel: let an UnknownBoundary omit its cause (a stop with no reason is uncountable)',
    file: 'src/ubg/kernel/facts.js',
    find: "  if (kind === 'UnknownBoundary' && provenance?.uncertainty == null)",
    repl: '  if (false)',
    test: 'tests/node-kernel.test.js',
  },
  {
    desc: 'kernel: report an unmeasured walk as COMPLETE (UNKNOWN silently becomes CLEAN)',
    file: 'src/ubg/kernel/facts.js',
    find: '    complete: byKind.UnknownBoundary > 0 ? false : null,',
    repl: '    complete: byKind.UnknownBoundary === 0,',
    test: 'tests/node-kernel.test.js',
  },
  {
    desc: 'kernel: swallow an unresolved instance member instead of declaring it (hard rule 9)',
    file: 'src/ubg/resolve.js',
    find: '        unknown(\n          here,\n          node.loc?.start.line ?? 0,\n          `${inst.className}.${method}`,',
    repl: '        if (false)\n        unknown(\n          here,\n          node.loc?.start.line ?? 0,\n          `${inst.className}.${method}`,',
    test: 'tests/node-kernel.test.js',
  },
  {
    desc: 'kernel: drop the facts extraction recorded before lifting (F1 for the kernel)',
    file: 'src/ubg/compile.js',
    find: '    ledger: kernel,\n    occurrences: effectOccurrences,',
    repl: '    occurrences: effectOccurrences,',
    test: 'tests/node-kernel.test.js',
  },
  {
    desc: 'kernel: treat any trailing function as a Node callback (the ledger describes JS, not the program)',
    file: 'src/ubg/extract.js',
    find: "  if (first?.type !== 'Identifier') return false;\n  return /^(err|error|e)$/i.test(first.name);",
    repl: '  return true;',
    test: 'tests/node-kernel.test.js',
  },
  // ---- Node Semantic Kernel (slice 2: silent stops + DataSource → DbEffect) ----
  {
    desc: 'kernel: swallow a bare call with no binding (a helper hop leaves no trace)',
    file: 'src/ubg/resolve.js',
    find: '          if (!isInertReceiver(name) && !GLOBAL_FUNCTIONS.has(name)) {',
    repl: '          if (false) {',
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: read a COMPUTED member name as if it were static (invents the method)',
    file: 'src/ubg/resolve.js',
    find: "      const computedMember = callee.computed && callee.property.type !== 'StringLiteral';",
    repl: '      const computedMember = false;',
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: drop the unresolved-receiver boundary (an unbound service hop goes silent)',
    file: 'src/ubg/resolve.js',
    find: "                : 'unresolved-receiver',",
    repl: "                : 'depth-budget',",
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: lose the request ORIGIN across a call boundary (DataSource → DbEffect breaks)',
    file: 'src/ubg/resolve.js',
    find: '    const origin = requestOriginOf(arg, callerReq?.origins);',
    repl: '    const origin = null;',
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: stop entering a nested filter builder (find(criteria()) loses its origins)',
    file: 'src/ubg/extract.js',
    find: '      nestedFns.has(n.callee.name) &&',
    repl: '      false &&',
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: drop the DataSource → DbEffect edge at translation (computed then thrown away)',
    file: 'src/ubg/translate.js',
    find: '          ...(eff.filterOrigins !== undefined\n            ? { filterOrigins: eff.filterOrigins }\n            : {}),',
    repl: '          ...(false ? { filterOrigins: eff.filterOrigins } : {}),',
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: promote OBJECT_SCOPE_UNPROVEN to a hard high finding (forbidden without an ADR)',
    file: 'src/ubg/apocalypse.js',
    find: "        severity: 'info',\n        advisory: true,\n        entrypoint: ep.id,\n        ownership,",
    repl: "        severity: 'high',\n        advisory: false,\n        entrypoint: ep.id,\n        ownership,",
    test: 'tests/node-kernel-dataflow.test.js',
  },
  // ---- Node Semantic Kernel (slice 3: the last declared-but-silent causes) ----
  {
    desc: 'kernel: a continuation handed to an unresolved callee stops being opaque',
    file: 'src/ubg/resolve.js',
    find: "                : handsOverCallback(node)\n                  ? 'opaque-callback'\n                  : imported",
    repl: "                : false\n                  ? 'opaque-callback'\n                  : imported",
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: an unpaired producer/consumer stops being a queue gap',
    file: 'src/ubg/resolve.js',
    find: "              : QUEUE_VERBS.has(method)\n                ? 'unresolved-queue'",
    repl: "              : false\n                ? 'unresolved-queue'",
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: an unopenable declaring scope reads as a merely missing method',
    file: 'src/ubg/resolve.js',
    find: "          instanceReachable ? 'unresolved-module' : 'unreachable-capture',",
    repl: "          'unresolved-module',",
    test: 'tests/node-kernel-dataflow.test.js',
  },
  {
    desc: 'kernel: an unreadable DB target stops raising a boundary (hidden inside a field)',
    file: 'src/ubg/kernel/lift.js',
    find: '  if (meta.table == null)',
    repl: '  if (false)',
    test: 'tests/kernel-symbolic-target.test.js',
  },
  {
    desc: 'G1: let client-supplied input build an ownership assertion (a filter proves itself)',
    file: 'src/ubg/extract.js',
    find: '      if (clientSupplied(p.value)) continue;',
    repl: '      if (false) continue;',
    test: 'tests/kernel-owner-asserted.test.js',
  },
  // ---- per-route effect occurrences + origin-aware ownership ----
  {
    desc: 'occurrence: drop the route key so two routes share one proof',
    file: 'src/ubg/kernel/lift.js',
    find: '          `${entrypoint.id}:${occurrence.owner}:${occurrence.effect}`,',
    repl: '          `${occurrence.owner}:${occurrence.effect}`,',
    test: 'tests/kernel-effect-occurrence.test.js',
  },
  {
    desc: 'occurrence: let a shared effect node keep the FIRST body\u2019s scope (contamination)',
    file: 'src/ubg/translate.js',
    find: '      if (!eff.ownerScoped) delete reused.meta.ownerScoped;',
    repl: '      if (false) delete reused.meta.ownerScoped;',
    test: 'tests/kernel-effect-occurrence.test.js',
  },
  {
    desc: 'ownership: let a client-supplied value survive into the owner-scope check',
    file: 'src/ubg/extract.js',
    find: '  const kept = withoutClientSuppliedProps(whereNode, ctx);',
    repl: '  const kept = whereNode;',
    test: 'tests/kernel-effect-occurrence.test.js',
  },
  {
    desc: 'ownership: recognise a scope by KEY NAME only, ignoring the value\u2019s origin',
    file: 'src/ubg/extract.js',
    find: '  if (sessionDerivedProp(kept, ctx)) return true;',
    repl: '  if (false) return true;',
    test: 'tests/node-kernel-dataflow.test.js',
  },
  // ---- corpus reproducibility ----
  {
    desc: 'fingerprint: stop normalising line endings (the pin goes back to pinning the checkout)',
    file: 'bench/soundness/fingerprint.mjs',
    find: '    if (byte === 0x0d) {',
    repl: '    if (false) {',
    test: 'tests/corpus-source-fingerprint.test.js',
  },
  {
    desc: 'fingerprint: report a platform-dependent raw pin as portable',
    file: 'bench/soundness/fingerprint.mjs',
    find: "    ? { status: 'legacy', actual }",
    repl: "    ? { status: 'portable', actual: actual }",
    test: 'tests/corpus-source-fingerprint.test.js',
  },
  {
    desc: 'fingerprint: let a missing source file pass instead of failing',
    file: 'bench/soundness/fingerprint.mjs',
    find: "  if (!fs.existsSync(file)) return { status: 'mismatch', reason: 'missing file' };",
    repl: "  if (!fs.existsSync(file)) return { status: 'portable' };",
    test: 'tests/corpus-source-fingerprint.test.js',
  },
  {
    desc: 'bench: an unmapped rule stops counting anywhere (invisible by omission)',
    file: 'bench/soundness/run.mjs',
    find: '  if (!property) return true;',
    repl: '  if (!property) return false;',
    test: 'tests/bench-property-scope.test.js',
  },
  {
    desc: 'bench: drop the pre-split figure, so a definition change reads as a behaviour change',
    file: 'bench/soundness/run.mjs',
    find: '      anyHardFinding: anyHardFinding.length,',
    repl: '      anyHardFinding: falseHigh.length,',
    test: 'tests/bench-property-scope.test.js',
  },
  {
    desc: 'extract: read a crypto root as a builder table again (createHash("md5") → table md5)',
    file: 'src/ubg/extract.js',
    find: "      if (c.type === 'Identifier' && nonDbRoots?.has(c.name)) return { nonDb: true };",
    repl: '      // mutant: the crypto root is a table again',
    test: 'tests/crypto-is-not-a-table.test.js',
  },
  {
    desc: 'extract: escalate the builder refusal from LOCAL to a return — the call goes silent',
    file: 'src/ubg/extract.js',
    find: '    if (resolved && !declined) {',
    repl: '    if (declined) return;\n    if (resolved) {',
    test: 'tests/crypto-is-not-a-table.test.js',
  },
  {
    desc: 'nestjs: unwire the kernel ledger — every DI resolution stop goes silent again',
    file: 'src/ubg/nestjs.js',
    find: '    helpers,\n    kernel,\n',
    repl: '    helpers,\n',
    test: 'tests/workspace-boundary.test.js',
  },
  {
    desc: 'compile: stop handing the ledger to the DI lowering (same silence, one layer up)',
    file: 'src/ubg/compile.js',
    find: 'nestjs: () => extractNest(cwd, stack.entryFile, { kernel }),',
    repl: 'nestjs: () => extractNest(cwd, stack.entryFile),',
    test: 'tests/workspace-boundary.test.js',
  },
  {
    desc: 'extract: drop the specifier of an unresolved workspace import (root cause lost)',
    file: 'src/ubg/extract.js',
    find: '  const pkg = workspacePackageOf(absFile, specifier);\n  if (!pkg) return;',
    repl: '  const pkg = workspacePackageOf(absFile, specifier);\n  if (pkg) return;',
    test: 'tests/workspace-boundary.test.js',
  },
  {
    desc: 'resolve: let the generic cause outrank the workspace one (a package becomes a name)',
    file: 'src/ubg/resolve.js',
    find: '          const miss = workspaceMiss(mod, obj.name);',
    repl: '          const miss = null;',
    test: 'tests/workspace-boundary.test.js',
  },
  {
    desc: 'resolve: drop the DI handler owner again — every stop below a controller unattachable',
    file: 'src/ubg/resolve.js',
    find: '      ownerKeyOf(mod, method, method?.key?.name ?? null),',
    repl: '      null,',
    test: 'tests/owner-identity.test.js',
  },
  {
    desc: 'resolve: drop the interprocedural body owner (class-method stops float free)',
    file: 'src/ubg/resolve.js',
    find: "      ownerKeyOf(hit.mod, hit.fn, `${topCls.id?.name ?? 'anonymous'}.${methodName}`),",
    repl: '      null,',
    test: 'tests/owner-identity.test.js',
  },
  {
    desc: 'schema: give the owner key a second format again (boundary and node stop joining)',
    file: 'src/ubg/schema.js',
    find: 'export const bodyKey = (file, name, line) => `${normalizeRelPath(file)}#${name}:${line}`;',
    repl: 'export const bodyKey = (file, name, line) => `${normalizeRelPath(file)}#${line}`;',
    test: 'tests/owner-identity.test.js',
  },
  {
    desc: 'schema: stop normalising the path — an absolute owner never compares equal',
    file: 'src/ubg/schema.js',
    find: "  const posix = String(file ?? '').replace(/\\\\/g, '/');\n  return posix.replace(/^\\.\\//, '');",
    repl: "  return String(file ?? '');",
    test: 'tests/owner-identity.test.js',
  },
  {
    desc: 'resolve: return a null owner for every body (the join silently stops joining)',
    file: 'src/ubg/resolve.js',
    find: '    if (!mod?._file || !name) return null;',
    repl: '    if (true) return null;',
    test: 'tests/owner-identity.test.js',
  },
  {
    desc: 'attach: never stamp the body -> boundary edge (the route can no longer see its own gap)',
    file: 'src/ubg/kernel/attach.js',
    find: '    if (node.meta.unknownBoundaries.some((b) => b.id === fact.id)) continue;',
    repl: '    continue;',
    test: 'tests/unknown-dependency-blocks-proven.test.js',
  },
  {
    desc: 'attach: join on a divergent owner key — every boundary becomes an orphan',
    file: 'src/ubg/kernel/attach.js',
    find: '    byBody.set(bodyKeyOfNodeId(node.id), node);',
    repl: '    byBody.set(node.id, node);',
    test: 'tests/unknown-dependency-blocks-proven.test.js',
  },
  {
    desc: 'blindspots: drop the route propagation — an affected route stops being affected',
    file: 'src/ubg/blindspots.js',
    find: '        if (!affectedProperties(b.reason).length) continue;',
    repl: '        continue;',
    test: 'tests/unknown-dependency-blocks-proven.test.js',
  },
  {
    desc: 'enforce: remove the PROVEN prohibition over an unreadable dependency',
    file: 'src/commands/enforce.js',
    find: "        s.kind === 'unresolved-dependency' &&",
    repl: '        false &&',
    test: 'tests/unknown-dependency-blocks-proven.test.js',
  },
  {
    desc: 'blindspots: propagate to every route, not the reachable ones (/independent goes unknown)',
    file: 'src/ubg/blindspots.js',
    find: '    for (const id of reachOf(ep.id, g.cfOut)) {',
    repl: '    for (const id of g.nodes.keys()) {',
    test: 'tests/unknown-dependency-blocks-proven.test.js',
  },
  {
    desc: 'corpus: pin the blocked-route COUNT instead of the set (73 different routes read as no change)',
    file: 'scripts/route-risk.mjs',
    find: '    ...new Set(dependency.map((s) => `${causeKeyOf(s)} ${s.entrypoint}`)),',
    repl: '    ...new Set(dependency.map((s) => `${causeKeyOf(s)}`)),',
    test: 'tests/corpus-route-risk.test.js',
  },
  {
    desc: 'corpus: report an unmeasured route-risk dimension as [] — the null → empty lie',
    file: 'scripts/route-risk.mjs',
    find: '  if (!measured) return { byRisk: risk, blocked: null, blockedByCause: null };',
    repl: '  if (!measured) return { byRisk: risk, blocked: [], blockedByCause: {} };',
    test: 'tests/corpus-route-risk.test.js',
  },
  {
    desc: 'corpus: fabricate zeroes for a missing byRisk instead of admitting null',
    file: 'scripts/route-risk.mjs',
    find: '      : null;\n  if (!measured)',
    repl: '      : { critical: 0, high: 0, medium: 0, low: 0 };\n  if (!measured)',
    test: 'tests/corpus-route-risk.test.js',
  },
  {
    desc: 'corpus: drop the reason from the cause key — a different root cause reads as the same',
    file: 'scripts/route-risk.mjs',
    find: "  `${spot.reason ?? 'unknown-cause'}:${spot.label ?? '<unnamed>'}`;",
    repl: "  `${spot.label ?? '<unnamed>'}`;",
    test: 'tests/corpus-route-risk.test.js',
  },
  {
    desc: 'corpus: stop sorting the blocked set — walk order leaks into the snapshot',
    file: 'scripts/route-risk.mjs',
    find: '    ...new Set(dependency.map((s) => `${causeKeyOf(s)} ${s.entrypoint}`)),\n  ].sort(cmp);',
    repl: '    ...new Set(dependency.map((s) => `${causeKeyOf(s)} ${s.entrypoint}`)),\n  ];',
    test: 'tests/corpus-route-risk.test.js',
  },
  {
    desc: 'tapp-0: unwire the Prisma origin branch — the contract goes back to zero linkage',
    file: 'src/ubg/extract.js',
    find: "      const roles = originRoles(\n        { filter: whereNode, data: optionValueOf(node.arguments[0], 'data') },\n        ctx,\n      );",
    repl: '      const roles = { filterOrigins: null, dataOrigins: null };',
    test: 'tests/tapp-origins.test.js',
  },
  {
    desc: 'tapp-0: swap filter and data origins — an object-scope question read as a validation one',
    file: 'src/ubg/extract.js',
    find:
      '    filterOrigins: originsForRole(filter, ctx),\n' +
      '    dataOrigins: originsForRole(data, ctx),',
    repl:
      '    filterOrigins: originsForRole(data, ctx),\n' +
      '    dataOrigins: originsForRole(filter, ctx),',
    test: 'tests/tapp-origins.test.js',
  },
  {
    desc: 'tapp-0: report an unmeasurable role as [] — the null → empty lie, at the origin layer',
    file: 'src/ubg/extract.js',
    find: '  if (opaque) return null;',
    repl: '  if (opaque) return [];',
    test: 'tests/tapp-origins.test.js',
  },
  {
    desc: 'tapp-0: let a computed access path claim a precise origin instead of declaring the limit',
    file: 'src/ubg/extract.js',
    find: "  if (\n    node.type === 'MemberExpression' &&\n    node.computed &&\n    node.property?.type !== 'StringLiteral'\n  )\n    return null;",
    repl: '  if (false) return null;',
    test: 'tests/tapp-origins.test.js',
  },
  {
    desc: 'tapp-0: collapse null into [] at the occurrence — an unmeasured role reads as inspected',
    file: 'src/ubg/translate.js',
    find: '        filterOrigins: eff.filterOrigins ?? null,\n        dataOrigins: eff.dataOrigins ?? null,',
    repl: '        filterOrigins: eff.filterOrigins ?? [],\n        dataOrigins: eff.dataOrigins ?? [],',
    test: 'tests/tapp-origins.test.js',
  },
  {
    desc: 'tapp-0: drop the origin dimension from the corpus (invisible like byRisk was)',
    file: 'scripts/route-risk.mjs',
    find: '  if (!Array.isArray(occurrences)) return null;',
    repl: '  return null; // eslint-disable-line',
    test: 'tests/corpus-route-risk.test.js',
  },
  {
    desc: 'directory-index: guess index.js past a directory’s own package.json (wrong module analysed)',
    file: 'src/ubg/extract.js',
    find: "  const indexFallback = directoryOwnsItsResolution(base)\n    ? []\n    : [path.join(base, 'index.ts'), path.join(base, 'index.js')];",
    repl: "  const indexFallback = [path.join(base, 'index.ts'), path.join(base, 'index.js')];",
    test: 'tests/directory-index.test.js',
  },
  {
    desc: 'directory-index: stop detecting a shadowed `require` — a mount resolves to a file it never loads',
    file: 'src/ubg/express.js',
    find: '    if (mod?.requireShadowed) return null;',
    repl: '    if (false) return null;',
    test: 'tests/directory-index.test.js',
  },
  {
    desc: 'directory-index: never flag `require` as shadowed (the detector goes blind)',
    file: 'src/ubg/extract.js',
    find: '  facts.requireShadowed = requireIsShadowed(facts.ast);',
    repl: '  facts.requireShadowed = false;',
    test: 'tests/directory-index.test.js',
  },
  {
    desc: 'directory-index: miss a `require` shadowed by a PARAMETER (the commonest form)',
    file: 'src/ubg/extract.js',
    find: "        if (param?.type === 'Identifier' && param.name === 'require') shadowed = true;",
    repl: '        if (false) shadowed = true;',
    test: 'tests/directory-index.test.js',
  },
  {
    desc: 'directory-index: let a directory index outrank a real file of the same name',
    file: 'src/ubg/extract.js',
    find: '  for (const cand of [\n    base,\n    `${base}.ts`,',
    repl: '  for (const cand of [\n    ...indexFallback,\n    base,\n    `${base}.ts`,',
    test: 'tests/directory-index.test.js',
  },
  {
    desc: 'nest-path: unwire the static grammar — every template/const path goes back to the prefix',
    file: 'src/ubg/nestjs.js',
    find: '    const statik = mod && pathArg ? staticPathsOf(pathArg, mod) : null;',
    repl: '    const statik = null;',
    test: 'tests/nest-static-route-paths.test.js',
  },
  {
    desc: 'nest-path: accept a mutable binding as a path (let is not forced at build time)',
    file: 'src/ubg/nest-static-path.js',
    find: "    if (decl?.type !== 'VariableDeclaration' || decl.kind !== CONST_KIND) continue;",
    repl: "    if (decl?.type !== 'VariableDeclaration') continue;",
    test: 'tests/nest-static-route-paths.test.js',
  },
  {
    desc: 'nest-path: resolve a MODULE-PRIVATE const through a named import (not actually visible)',
    file: 'src/ubg/nest-static-path.js',
    find:
      "    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue;\n" +
      '    const decl = node.declaration;',
    repl: "    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;",
    test: 'tests/nest-static-route-paths.test.js',
  },
  {
    desc: 'nest-path: read an aliased import by its LOCAL name (the wrong export, or none)',
    file: 'src/ubg/nest-static-path.js',
    find: '      return { name: imported.name, source: node.source.value };',
    repl: '      return { name: spec.local.name, source: node.source.value };',
    test: 'tests/nest-static-route-paths.test.js',
  },
  {
    desc: 'nest-path: share the cycle set across siblings — one const read twice looks like a loop',
    file: 'src/ubg/nest-static-path.js',
    find: '    const nextSeen = new Set(seen).add(key);',
    repl: '    const nextSeen = seen.add(key);',
    test: 'tests/nest-static-route-paths.test.js',
  },
  {
    desc: 'nest-path: accept a PARTIAL array — one unreadable element silently drops a served URL',
    file: 'src/ubg/nest-static-path.js',
    find: '      if (!resolved) return null;\n      out.push(...resolved);',
    repl: '      if (!resolved) continue;\n      out.push(...resolved);',
    test: 'tests/nest-static-route-paths.test.js',
  },
  {
    desc: 'nest-path: keep the dynamic-path boundary after the path IS resolved (a doubt that never clears)',
    file: 'src/ubg/nestjs.js',
    find: '    const unreadable = statik\n      ? []',
    repl: '    const unreadable = false\n      ? []',
    test: 'tests/nest-static-route-paths.test.js',
  },
  {
    desc: 'nest-path: let an unresolved path LOSE its declared boundary (a silent wrong URL)',
    file: 'src/ubg/nestjs.js',
    find: '      ...(unreadable.length ? { pathDynamic: true } : {}),',
    repl: '      ...(false ? { pathDynamic: true } : {}),',
    test: 'tests/nest-static-route-paths.test.js',
  },
  // TAPP-1 — the local access path. Each of these is a way to make the evidence
  // say more than it proved, or to make a declared limit disappear.
  {
    desc: 'tapp-1: unwire the access path — every role goes back to a surface with no steps',
    file: 'src/ubg/extract.js',
    find: "    filterPaths: accessPathsForRole(filter, 'filter', ctx),",
    repl: '    filterPaths: null,',
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: drop local ASSIGNMENT propagation — `const email = req.body.email` loses its step',
    file: 'src/ubg/extract.js',
    find: "          steps.set(n.id.name, {\n            via: 'assign',",
    repl: "          void ({\n            via: 'assign',",
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: drop static DESTRUCTURING — the dominant handler idiom stops being statable',
    file: 'src/ubg/extract.js',
    find: '            steps.set(local, {\n' + "              via: 'destructure',",
    repl: "            void {\n              via: 'destructure',",
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: launder the NORMALIZER — a converted value looks like it arrived untouched',
    file: 'src/ubg/extract.js',
    find: "    if (step.via === 'normalizer') out.unshift(`${step.callee ?? '<call>'}()`);",
    repl: "    if (false) out.unshift(`${step.callee ?? '<call>'}()`);",
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: accept a WHOLE-SURFACE pass as a precise property (mass assignment, invented)',
    file: 'src/ubg/extract.js',
    find:
      '  if (origin.name == null) {\n' +
      '    out.wholeSurface.add(origin.origin);\n' +
      '    return;\n' +
      '  }',
    repl: "  if (origin.name == null) origin = { ...origin, name: '*' };",
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: read a COMPUTED destination key as a static one — an invented access path',
    file: 'src/ubg/extract.js',
    find: "      if (prop.type !== 'ObjectProperty' || prop.computed) continue;",
    repl: "      if (prop.type !== 'ObjectProperty') continue;",
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: drop the RECONCILIATION — an unplaceable origin becomes an absence of flow',
    file: 'src/ubg/extract.js',
    find: "    if (placedSources.has(`${o.origin}:${o.name ?? '*'}`)) continue;",
    repl: '    continue;',
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: report an unreadable path as [] — the null → empty lie, at the path layer',
    file: 'src/ubg/kernel/lift.js',
    find: '            path: resolved ? entry.path : null,',
    repl: '            path: resolved ? entry.path : [],',
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: erase the ROUTE from the fact key — a shared handler gets one shared proof',
    file: 'src/ubg/kernel/lift.js',
    find: "            `${entrypoint.id}:${occurrence.owner}:${occurrence.effect}:${role}:${entry.origin}.${entry.name ?? '*'}:${entry.dest ?? '<unknown>'}`,",
    repl: "            `${occurrence.owner}:${occurrence.effect}:${role}:${entry.origin}.${entry.name ?? '*'}:${entry.dest ?? '<unknown>'}`,",
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: erase the DESTINATION from the fact key — one source landing twice keeps one path',
    file: 'src/ubg/kernel/lift.js',
    find: "${role}:${entry.origin}.${entry.name ?? '*'}:${entry.dest ?? '<unknown>'}`,",
    repl: "${role}:${entry.origin}.${entry.name ?? '*'}`,",
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: let the boundary GATE a proof — evidence quietly becomes a verdict rule',
    file: 'src/ubg/kernel/attach.js',
    find: "  'unresolved-workspace-module': Object.freeze(['db-effect']),",
    repl: "  'unresolved-workspace-module': Object.freeze(['db-effect']),\n  'unknown-access-path': Object.freeze(['db-effect']),",
    test: 'tests/tapp-local-access-paths.test.js',
  },
  {
    desc: 'tapp-1: report an unmeasurable role as a measured one in the corpus dimension',
    file: 'scripts/route-risk.mjs',
    find: '      if (o[key] === null) unmeasuredRoles += 1;',
    repl: '      if (false) unmeasuredRoles += 1;',
    test: 'tests/corpus-route-risk.test.js',
  },
  // TAPP-2 — the one interprocedural seam. Each of these turns a refusal into an
  // assertion, or an assertion into a silence.
  {
    desc: 'tapp-2: write a step kind the reader does not know — the wiring rule must catch it',
    file: 'src/ubg/resolve.js',
    find: "      via: 'parameter',\n      from: null,\n      hop: [...before,",
    repl: "      via: 'parameter-v2',\n      from: null,\n      hop: [...before,",
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: unwire the parameter hop — every multi-file trajectory goes back to a boundary',
    file: 'src/ubg/resolve.js',
    find: "      via: 'parameter',\n      from: null,\n      hop: [...before",
    repl: "      via: 'unwired',\n      from: null,\n      hop: [...before",
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: stop reading the parameter hop — the callee side forgets how the value arrived',
    file: 'src/ubg/extract.js',
    find: "    if (step.via === 'parameter') {",
    repl: '    if (false) {',
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: accept a SPREAD call — a position that is not determined is bound anyway',
    file: 'src/ubg/resolve.js',
    find: "    !args.some((a) => a?.type === 'SpreadElement') &&",
    repl: '    true &&',
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: accept a REST signature — "position i" stops meaning one argument',
    file: 'src/ubg/resolve.js',
    find: "    !fn.params.some((p) => p?.type === 'RestElement') &&",
    repl: '    true &&',
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: accept DUPLICATE parameter names — two bindings, one claimed position',
    file: 'src/ubg/resolve.js',
    find:
      "    new Set(fn.params.map((p) => (p?.type === 'Identifier' ? p.name : null))).size ===\n" +
      '      fn.params.length;',
    repl: '    true;',
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: ignore a REBOUND parameter — a path that claims the client chose a constant',
    file: 'src/ubg/resolve.js',
    find: '    if (paramRebound(fn, id.name)) return;',
    repl: '    if (false) return;',
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: bind arguments by NAME instead of by position — the payload and the filter swap',
    file: 'src/ubg/resolve.js',
    find: '    const arg = args[i];',
    repl: "    const arg = args.find((a) => a?.type === 'Identifier' && a.name === id.name) ?? args[i];",
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: name the hop after the RECEIVER VARIABLE — evidence about a name, not a body',
    file: 'src/ubg/resolve.js',
    find: '            `${inst.className}.${method}`,',
    repl: "            `${obj.name ?? '?'}.${method}`,",
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: drop the inline transform — the NodeGoat filter leg stops being statable',
    file: 'src/ubg/extract.js',
    find:
      '  const inline =\n' +
      '    transforms.length < MAX_INLINE_TRANSFORMS ? inlineTransformOf(node) : null;',
    repl: '  const inline = null;',
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: HIDE the inline transform — the value reads as if it arrived untouched',
    file: 'src/ubg/extract.js',
    find: '    ? { label: `${node.callee.name}()`, argument: node.arguments[0] }',
    repl: "    ? { label: '', argument: node.arguments[0] }",
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  {
    desc: 'tapp-2: accept a MULTI-argument inline call — two values, one apportioned path',
    file: 'src/ubg/extract.js',
    find: '  node.arguments.length === 1',
    repl: '  node.arguments.length >= 1',
    test: 'tests/tapp-interprocedural-paths.test.js',
  },
  // Nest static direct provider V1 (ADR-102). Each of these turns a provenance
  // check into a name check, or a refusal into a claim.
  {
    desc: 'nest-provider: unwire the pass — every proved route→ORM linkage disappears',
    file: 'src/ubg/nestjs.js',
    find: '    nestDirectProviderLinkages({',
    repl: '    [] || nestDirectProviderLinkages({',
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: trust the DECORATOR NAME — a local InjectRepository lookalike is credited',
    file: 'src/ubg/nest-provider.js',
    find: '      if (bound?.source !== official.pkg || bound.imported !== official.inject) continue;',
    repl: '      if (false) continue;',
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: trust the FACTORY NAME — a local TypeOrmModule lookalike registers entities',
    file: 'src/ubg/nest-provider.js',
    find: '    const official = officialBinding(mod, el.callee.object.name, el.callee.object.name);\n    if (!official) continue;',
    repl: "    const official = officialBinding(mod, el.callee.object.name, el.callee.object.name) ?? { pkg: '@nestjs/typeorm', factory: 'TypeOrmModule', inject: 'InjectRepository', orm: 'typeorm' };",
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: accept a NON-LITERAL provider list — a token binding reads as a class',
    file: 'src/ubg/nest-provider.js',
    find: "    if (el?.type !== 'Identifier') return null;\n    out.push(el.name);",
    repl: "    if (el?.type !== 'Identifier') continue;\n    out.push(el.name);",
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: accept an @Inject-decorated parameter — the container’s choice read as the source’s',
    file: 'src/ubg/nest-provider.js',
    find: '    if ((p.decorators ?? []).length || (id.decorators ?? []).length) {',
    repl: '    if (false) {',
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: match the entity by NAME instead of by FILE — a mismatched forFeature passes',
    file: 'src/ubg/nest-provider.js',
    find: '              if (!svcEntityFile || !modEntityFile || svcEntityFile !== modEntityFile) {',
    repl: '              if (false) {',
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: widen the operation vocabulary — an unmeasured ORM call becomes a claim',
    file: 'src/ubg/nest-provider.js',
    find: '              if (!V1_OPS.has(orm.member)) {',
    repl: '              if (false) {',
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: accept a NON-RELATIVE import — an alias resolves as an exact relative one',
    file: 'src/ubg/nest-provider.js',
    find: "  if (!hit || !hit.source.startsWith('.')) return null;",
    repl: '  if (!hit) return null;',
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: let the linkage create an EFFECT claim where the graph has none',
    file: 'src/ubg/kernel/lift.js',
    find: '    const effect = effectsByFileOp.get(`${link.providerFile}:${link.line}`) ?? null;',
    repl: "    const effect = effectsByFileOp.get(`${link.providerFile}:${link.line}`) ?? 'effect:db_write:synthetic';",
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: let the boundary GATE a proof — evidence quietly becomes a verdict rule',
    file: 'src/ubg/kernel/attach.js',
    find: "  'unresolved-workspace-module': Object.freeze(['db-effect']),",
    repl: "  'unresolved-workspace-module': Object.freeze(['db-effect']),\n  'unresolved-provider': Object.freeze(['db-effect']),",
    test: 'tests/nest-direct-provider.test.js',
  },
  {
    desc: 'nest-provider: stop pinning the corpus refusals — a grammar that went blind reads clean',
    file: 'scripts/route-risk.mjs',
    find: '    declined: (boundaries ?? []).length,',
    repl: '    declined: 0,',
    test: 'tests/corpus-route-risk.test.js',
  },
  // Express CommonJS router-value V1 (ADR-103). Each of these turns a proved
  // topology into a guessed one, or a declared refusal back into silence.
  {
    desc: 'router-value: unwire the discriminator — the whole unpathed router tree disappears again',
    file: 'src/ubg/express.js',
    find: '        if (verdict && args.length === 1) {',
    repl: '        if (false) {',
    test: 'tests/express-router-value.test.js',
  },
  {
    desc: 'router-value: mount ANY required module — an object export becomes a route tree',
    file: 'src/ubg/express-router-value.js',
    find: '      if (isRouterFactory(d.init, mod)) return { router: true, file };',
    repl: '      return { router: true, file };',
    test: 'tests/express-router-value.test.js',
  },
  {
    desc: 'router-value: accept a non-express Router factory — a local lookalike mounts',
    file: 'src/ubg/express-router-value.js',
    find: '    return requireSpecifierOf(mod, callee.object.name)?.spec === EXPRESS_PKG;',
    repl: '    return true;',
    test: 'tests/express-router-value.test.js',
  },
  {
    desc: "router-value: drop the chained require('express').Router() form — 11 real routes go back to a refusal",
    file: 'src/ubg/express-router-value.js',
    find: '    if (isExpressRequireCall(callee.object)) return true;',
    repl: '    if (false) return true;',
    test: 'tests/express-router-value.test.js',
  },
  {
    desc: 'router-value: mount under a DYNAMIC prefix — a whole sub-tree invented at a guessed path',
    file: 'src/ubg/express.js',
    find: '      if (args.length > 1) {',
    repl: '      if (false) {',
    test: 'tests/express-router-value.test.js',
  },
  {
    desc: 'router-value: swallow the refusal — an unprovable mount goes back to silence',
    file: 'src/ubg/express.js',
    find: '          isRequiredModuleArg(a, mod)\n        )',
    repl: '          false\n        )',
    test: 'tests/express-router-value.test.js',
  },
  {
    desc: 'router-value: declare ordinary middleware too — every app.use(fn) becomes a refusal',
    file: 'src/ubg/express.js',
    find: '          !verdict.callable &&',
    repl: '          true &&',
    test: 'tests/express-router-value.test.js',
  },
  {
    desc: 'router-value: treat a function export as a Router — middleware read as a mount',
    file: 'src/ubg/express-router-value.js',
    find: '        FUNCTION_NODES.has(d.init?.type)',
    repl: '        false',
    test: 'tests/express-router-value.test.js',
  },

  // Nest Static Provider TAPP V1 — ADR-104. Each of these turns a REFUSED journey
  // into a stated one, or erases a journey that was stated. Both directions are
  // failures: the first claims a path the source does not prove, the second loses
  // the evidence the slice exists to produce.
  {
    desc: 'nest-tapp: trust the DECORATOR NAME — a project-local @Body becomes a request surface',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '  if (bound?.source !== NEST_COMMON || bound.imported !== call.callee.name) return null;',
    repl: '  if (false) return null;',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: accept TWO decorators on one parameter — pick a surface out of an ambiguity',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '  if (decorators.length !== 1) return null;',
    repl: '  if (decorators.length < 1) return null;',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: accept a CONFIGURED pipe instance — a transform decided by a value nobody read',
    file: 'src/ubg/nest-provider-tapp.js',
    find: "    if (a?.type !== 'Identifier') return null;",
    repl: "    if (a?.type !== 'Identifier') break;",
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: walk INTO nested bodies — a queued or deferred call reads as a direct one',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '      return; // a nested body is a different moment',
    repl: '      void 0; // a nested body is a different moment',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: drop the CONTROLLER-side directness check — a deferred provider call states a path',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '    !writtenDirectlyIn(controllerMethod, serviceCall) ||',
    repl: '    false ||',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: drop the PROVIDER-side directness check — an ORM call in a callback states a path',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '    !writtenDirectlyIn(serviceMethod, ormCall)',
    repl: '    false',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: ignore a SPREAD argument — positions guessed past the point they are readable',
    file: 'src/ubg/nest-provider-tapp.js',
    find: "  if ((args ?? []).some((a) => a?.type === 'SpreadElement')) return false;",
    repl: '  if (false) return false;',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: accept a parameter that is not a plain name — a rest or destructured position',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '  return (params ?? []).every((p) => paramIdentifier(p) !== null);',
    repl: '  return true;',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: stop checking positions at the ORM call — the second hop guessed',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '  const hop2Readable = positionsReadable(ormCall.arguments, []);',
    repl: '  const hop2Readable = true;',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: state a path over an AMBIGUOUS module binding — two modules, one chain claimed',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '  if (ambiguousModule)\n    return surfaces.map((s) => refuse(s, TAPP_REFUSALS.AMBIGUOUS_MODULE));',
    repl: '  if (false) return [];',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: count every module binding as unique — the uniqueness test stops being one',
    file: 'src/ubg/nest-provider.js',
    find: '          counts.set(id, (counts.get(id) ?? 0) + 1);',
    repl: '          counts.set(id, 1);',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: allow ONE value at two argument positions — a journey with two endings',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '    if (bare.length > 1) {',
    repl: '    if (bare.length > 2) {',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: DROP a value that travels in an unreadable shape (rule 9 — silence)',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '    if (!bare.length && !elsewhere) continue;',
    repl: '    if (!bare.length) continue;',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: ignore a CONTROLLER-side rebinding — the client credited with a value it lost',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '    if (rebound(controllerMethod, s.param)) {',
    repl: '    if (false) {',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: ignore a PROVIDER-side rebinding — the effect reads a value the client never sent',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '    if (rebound(serviceMethod, inner.name)) {',
    repl: '    if (false) {',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: stop seeing assignment as a rebinding — `dto = {…}` no longer breaks the chain',
    file: 'src/ubg/nest-provider-tapp.js',
    find: "      written?.type === 'Identifier' &&",
    repl: "      written?.type === 'ThisExpression' &&",
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: DEFAULT the role when the table has none — an unmeasured position named `data`',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '      const role = roles[j] ?? null;',
    repl: "      const role = roles[j] ?? 'data';",
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: give Sequelize TypeORM’s argument order — `update(values, options)` read backwards',
    file: 'src/ubg/nest-provider-tapp.js',
    find: "          ['update', ['data', 'filter']],",
    repl: "          ['update', ['filter', 'data']],",
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: give TypeORM Sequelize’s argument order — `update(criteria, …)` read backwards',
    file: 'src/ubg/nest-provider-tapp.js',
    find: "          ['update', ['filter', 'data']],",
    repl: "          ['update', ['data', 'filter']],",
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: keep only the FIRST destination — a second journey stated by nobody',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '      if (placeInArgument(prop.value, name, [...keys, key], depth + 1, out))\n        placedHere = true;',
    repl: '      if (placeInArgument(prop.value, name, [...keys, key], depth + 1, out)) {\n        placedHere = true;\n        break;\n      }',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: stop charging an unplaceable value — an array argument reads as "never arrived"',
    file: 'src/ubg/nest-provider-tapp.js',
    find: '  if (mentions(node, name)) out.unreadable = true;\n  return false;\n}',
    repl: '  return false;\n}',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: give the fact an OWNER body it was never proved from',
    file: 'src/ubg/kernel/lift.js',
    find: '          owner: null,\n          effect,\n          role: flow.role,',
    repl: '          owner: link.controller,\n          effect,\n          role: flow.role,',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: blank the boundary on a refused journey — an admission with nothing in it',
    file: 'src/ubg/kernel/lift.js',
    find: '          boundary: resolved ? null : UNKNOWN_ACCESS_PATH,\n          // The chain this path travelled',
    repl: '          boundary: null,\n          // The chain this path travelled',
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: drop the uncertainty CAUSE — a refusal nothing can aggregate by',
    file: 'src/ubg/kernel/lift.js',
    find: "          contract: 'nest/provider-tapp',\n          uncertainty: resolved ? null : 'unknown-access-path',",
    repl: "          contract: 'nest/provider-tapp',\n          uncertainty: null,",
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: claim the chain was proved by a TYPE rather than by the module literal',
    file: 'src/ubg/kernel/lift.js',
    find: "          basis: 'module-literal',\n          // WHICH refusal",
    repl: "          basis: 'type',\n          // WHICH refusal",
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: drop the ROUTE from the fact id — one route’s proof licensing another',
    file: 'src/ubg/kernel/lift.js',
    find: "          `${link.entrypoint}:${link.controller}:${link.provider}:${link.op}:${flow.role ?? '<unroled>'}:${flow.source.origin}.${flow.source.name ?? '*'}:${flow.dest ?? '<unknown>'}`,",
    repl: "          `${link.controller}:${link.provider}:${link.op}:${flow.role ?? '<unroled>'}:${flow.source.origin}.${flow.source.name ?? '*'}:${flow.dest ?? '<unknown>'}`,",
    test: 'tests/nest-provider-tapp.test.js',
  },
  {
    desc: 'nest-tapp: drop the refusal SHAPE — the cause survives and the thing to fix does not',
    file: 'src/ubg/kernel/lift.js',
    find: '          refusal: flow.reason,',
    repl: '          refusal: null,',
    test: 'tests/nest-provider-tapp.test.js',
  },
  // Nest Class Source Seeding V1 — ADR-105. Each of these either lets a request
  // surface cross a class boundary the SOURCE did not settle, or stops one
  // crossing a boundary it did. The first invents provenance; the second loses
  // the evidence the slice exists to produce.
  {
    desc: 'nest-seed: share ONE memoized bundle between two routes — one route\u2019s provenance licensing another',
    file: 'src/ubg/resolve.js',
    find: '${symSig(thisSymbols)}${seedSig(seed)}`;',
    repl: '${symSig(thisSymbols)}`;',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: accept a BARREL re-export as a proved provider class',
    file: 'src/ubg/nest-provider.js',
    find: '          if (!svcMod || svcMod.error || !classInModule(svcMod, svcName)) continue;',
    repl: '          if (!svcMod || svcMod.error) continue;',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: ignore PROVIDER ambiguity — two modules binding one class read as settled',
    file: 'src/ubg/nest-provider.js',
    find: '          if (!svcTarget || !unique(svcTarget.file, svcName)) continue;',
    repl: '          if (!svcTarget) continue;',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: ignore CONTROLLER ambiguity — a controller two modules declare reads as settled',
    file: 'src/ubg/nest-provider.js',
    find: '        if (!ctrlTarget || !unique(ctrlTarget.file, ctrlName)) continue;',
    repl: '        if (!ctrlTarget) continue;',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: seed EVERY Nest controller, not the ones whose bindings are proved',
    file: 'src/ubg/resolve.js',
    find: '    const surfaces = provedFieldsOf(mod, cls) ? nestSurfaceSeed(method, mod) : null;',
    repl: '    const surfaces = nestSurfaceSeed(method, mod);',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: stop checking that the walk opened the body the module literal proved',
    file: 'src/ubg/resolve.js',
    find: '    const proved = seed && provedFile && hit.mod?._file === provedFile ? seed : null;',
    repl: '    const proved = null;',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: drop the seed at the provider body — the surface never reaches the effect',
    file: 'src/ubg/resolve.js',
    find: '        reqDerivedSeed: seed,',
    repl: '        reqDerivedSeed: null,',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: hide the controller surfaces from the DI hop that reads them',
    file: 'src/ubg/resolve.js',
    find: '      surfaces,\n      EMPTY_CAPTURE,',
    repl: '      null,\n      EMPTY_CAPTURE,',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: bind the provider by TYPE NAME alone, ignoring what the module proved',
    file: 'src/ubg/resolve.js',
    find: '          provedField && provedField.name === dep.type',
    repl: '          provedField && provedField.name !== dep.type',
    test: 'tests/nest-class-seeding.test.js',
  },
  {
    desc: 'nest-seed: widen a narrowed surface — a whole-body pass reported as one property',
    file: 'src/ubg/resolve.js',
    find: '    origins.set(s.param, { origin: s.origin, name: s.name });',
    repl: "    origins.set(s.param, { origin: s.origin, name: s.name ?? 'x' });",
    test: 'tests/nest-class-seeding.test.js',
  },

  // E-118 — settling is not draining. Each of these puts the diagnostic back to
  // being read before the app's own error has arrived, which is the exact
  // confusion E-109 exists to end.
  {
    desc: 'probe-drain: settle WITHOUT waiting — the diagnostic read before the last stderr chunk lands',
    file: 'src/probe/probe.js',
    find: '  timer = setTimeout(finish, graceMs);',
    repl: '  finish();',
    test: 'tests/probe-drain.test.js',
  },
  {
    desc: 'probe-drain: stop listening for `end` — only the grace cap would ever settle it',
    file: 'src/probe/probe.js',
    find: "  stream.once('end', finish);",
    repl: '  void finish;',
    test: 'tests/probe-drain.test.js',
  },
  {
    desc: 'probe-drain: drop the BOUND — a live app whose stderr never ends hangs the probe',
    file: 'src/probe/probe.js',
    find: '  timer = setTimeout(finish, graceMs);\n  // never hold the process open for a diagnostic',
    repl: '  timer = null;\n  // never hold the process open for a diagnostic',
    test: 'tests/probe-drain.test.js',
  },
  {
    desc: 'probe-drain: let `done` run more than once — a diagnostic built twice from two states',
    file: 'src/probe/probe.js',
    find: '    if (fired) return;\n    fired = true;',
    repl: '    fired = true;',
    test: 'tests/probe-drain.test.js',
  },
  {
    desc: 'probe-drain: unwire the drain from settle — the four stop paths read stderr at the instant they stop',
    file: 'src/probe/probe.js',
    find: '      afterDrain(child?.stderr, DRAIN_GRACE_MS, () => {',
    repl: '      ((_s, _g, fn) => fn())(child?.stderr, DRAIN_GRACE_MS, () => {',
    test: 'tests/probe-drain.test.js',
  },
  // Nest strict proof chain (ADR-106). Every one of these turns a PROVENANCE
  // check into a NAME check, a bound into a truncation, or a refusal into a
  // claim — the three ways an eight-link receipt can be quietly reduced to seven.
  {
    desc: 'strict: unwire the pass — every strict receipt disappears',
    file: 'src/ubg/nestjs.js',
    find: '    nestStrictProviderChains({ cwd, moduleFiles, routes, ledger: kernel }),',
    repl: '    [] || nestStrictProviderChains({ cwd, moduleFiles, routes, ledger: kernel }),',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a legacy linkage stops admitting null — the receipt field goes missing',
    file: 'src/ubg/kernel/lift.js',
    find: '          strict: link.strict ?? null,',
    repl: '          strict: link.strict ?? undefined,',
    test: 'tests/unmeasured-is-not-a-pass.test.js',
  },
  {
    desc: 'strict: @Controller provenance becomes a NAME check — a local lookalike registers',
    file: 'src/ubg/nest-strict-chain.js',
    find: "  if (ctrlBound?.source !== NEST_COMMON || ctrlBound.imported !== 'Controller')",
    repl: '  if (false)',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: the HTTP decorator provenance becomes a NAME check',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (bound?.source !== NEST_COMMON || bound.imported !== name)\n      return { refusal: STRICT_REFUSALS.ROUTE_PROVENANCE };',
    repl: '    if (false)\n      return { refusal: STRICT_REFUSALS.ROUTE_PROVENANCE };',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: the TypeORM handle is accepted by NAME — ./fake-typeorm is credited',
    file: 'src/ubg/nest-strict-chain.js',
    find: '      direct?.source === ORM_PACKAGES.typeorm.pkg &&\n      direct.imported === ORM_PACKAGES.typeorm.handle',
    repl: '      type === ORM_PACKAGES.typeorm.handle',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: the Prisma superclass is accepted by NAME — ./prisma-lookalike is credited',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    bound?.source !== ORM_PACKAGES.prisma.pkg ||\n    bound.imported !== ORM_PACKAGES.prisma.handle',
    repl: '    bound === undefined && bound !== undefined',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: @Injectable provenance becomes a NAME check',
    file: 'src/ubg/nest-strict-chain.js',
    find: "    if (bound?.source === NEST_COMMON && bound.imported === 'Injectable')\n      return NEST_COMMON;",
    repl: '    if (bound || !bound)\n      return NEST_COMMON;',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a class with no @Injectable at all is accepted as a provider',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (!injectable) {',
    repl: '    if (false) {',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: @Inject(TOKEN) stops needing to be CONGRUENT with the type',
    file: 'src/ubg/nest-strict-chain.js',
    find: '  if (!tokenRef || !typeRef || refKey(tokenRef) !== refKey(typeRef)) return { ok: false };',
    repl: '  if (false) return { ok: false };',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a decorated parameter is no longer refused — the container decides and we claim',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (!congruent.ok) {',
    repl: '    if (false) {',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: useFactory / useValue stop being a container decision',
    file: 'src/ubg/nest-strict-chain.js',
    find: "    impl: null,\n    kind: 'container',\n    reason: STRICT_REFUSALS.CONTAINER_BINDING,",
    repl: "    impl: token,\n    kind: 'container',\n    reason: null,",
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: an unreadable provider entry no longer poisons the module',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    rec.fatal ??= STRICT_REFUSALS.UNREADABLE_MODULE;\n  }\n\n  const imps',
    repl: '    rec.fatal ??= null;\n  }\n\n  const imps',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a const aggregate mutated by push is read as immutable',
    file: 'src/ubg/nest-strict-chain.js',
    find: '  return mutatedAnywhere(mod.ast, name) ? null : names;',
    repl: '  return names;',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: two literal bindings for one token stop being ambiguous',
    file: 'src/ubg/nest-strict-chain.js',
    find: '  if (distinct.size > 1) return { refusal: STRICT_REFUSALS.AMBIGUOUS_BINDING };',
    repl: '  if (false) return { refusal: STRICT_REFUSALS.AMBIGUOUS_BINDING };',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: the interprocedural bound becomes 4 — the chain is truncated, not refused',
    file: 'src/ubg/nest-strict-chain.js',
    find: 'export const MAX_STRICT_HOPS = 3;',
    repl: 'export const MAX_STRICT_HOPS = 4;',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: an ORM call inside a callback counts as written in the body',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (!writtenDirectlyIn(method, call.node)) {',
    repl: '    if (false) {',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: the operation vocabulary stops being checked',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (!ORM_OPS[handle.orm].has(call.op)) {',
    repl: '    if (false) {',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: Mongoose no longer needs its official initialisation',
    file: 'src/ubg/nest-strict-chain.js',
    find: "  if (handle.orm === 'mongoose')",
    repl: "  if (handle.orm === 'mongoose' && false)",
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: MongooseModule.forFeature is accepted by NAME',
    file: 'src/ubg/nest-strict-chain.js',
    find: '  if (bound?.source !== pkg || bound.imported !== name) return false;',
    repl: '  if (false) return false;',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a computed member on an ORM handle is read as the operation',
    file: 'src/ubg/nest-strict-chain.js',
    find: "  if (callee.computed || callee.property?.type !== 'Identifier') return null;",
    repl: "  if (callee.property?.type !== 'Identifier' && !callee.computed) return null;",
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a computed call stops being DECLARED — the stop becomes silent',
    file: 'src/ubg/nest-strict-chain.js',
    find: '  for (const c of computedCallsOn(method, new Set([...handles.keys(), ...fake.keys()])))',
    repl: '  for (const c of [])',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a lookalike handle stops being DECLARED — the refusal becomes silence',
    file: 'src/ubg/nest-strict-chain.js',
    find: '  for (const [field, info] of fake)',
    repl: '  for (const [field, info] of [])',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a binding is no longer required to be found — NO_BINDING becomes a claim',
    file: 'src/ubg/nest-strict-chain.js',
    find: '  if (!found.length) return { refusal: STRICT_REFUSALS.NO_BINDING };',
    repl: '  if (!found.length) return { impl: null, kind: null, module: null, via: [] };',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: an imported module contributes bindings it never EXPORTED',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (mod.tokens.has(tokenKey) && (!mustExport || mod.exports.has(tokenKey))) {',
    repl: '    if (mod.tokens.has(tokenKey)) {',
    test: 'tests/nest-strict-chain.test.js',
  },
  // ADR-106 amendment — the TypeORM bridge. The first implementation proved eight
  // chains from a bare `Repository<Row>` parameter: a dependency no module
  // registers, in an app that does not resolve at runtime. Each mutant below
  // reopens exactly one link of that leak.
  {
    desc: 'strict: TypeORM stops needing its Nest bridge — the ORM import stands in for the binding',
    file: 'src/ubg/nest-strict-chain.js',
    find: "  if (handle.orm === 'typeorm') {",
    repl: "  if (handle.orm === 'typeorm' && false) {",
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: the injected entity no longer has to be the REGISTERED one',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    return binding.typeormEntities.has(refKey(handle.entityRef))',
    repl: '    return true || binding.typeormEntities.has(refKey(handle.entityRef))',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a NAMED TypeORM connection is read as the default one',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (!handle.defaultConnection) return STRICT_REFUSALS.ORM_CONNECTION;',
    repl: '    if (handle.defaultConnection && false) return STRICT_REFUSALS.ORM_CONNECTION;',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a missing forFeature stops being a missing registration',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (!binding.typeormEntities?.size) return STRICT_REFUSALS.ORM_INITIALISATION;',
    repl: '    if (binding.typeormEntities === null) return STRICT_REFUSALS.ORM_INITIALISATION;',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: @InjectRepository stops being required to name an entity at all',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (!handle.entityRef) return STRICT_REFUSALS.ORM_INITIALISATION;',
    repl: '    if (handle.entityRef === 0) return STRICT_REFUSALS.ORM_INITIALISATION;',
    test: 'tests/nest-strict-chain.test.js',
  },
  {
    desc: 'strict: a forFeature with a SECOND argument still registers the default connection',
    file: 'src/ubg/nest-strict-chain.js',
    find: '    if (feature && el.arguments.length === 1)',
    repl: '    if (feature || el.arguments.length === 99)',
    test: 'tests/nest-strict-chain.test.js',
  },
];

// THE JOURNAL. Signal handlers are not enough and this was measured, not assumed: the harness
// spends its whole life inside a BLOCKING `execFileSync`, so a signal that arrives mid-mutant
// cannot reach JS until the child returns, and a SIGKILL never reaches it at all. Interrupting a
// run left `src/ubg/nestjs.js` mutated on disk with every handler in place.
//
// So the recovery must not depend on the dying process doing anything. The original bytes are
// written to a journal BEFORE the file is touched, and the NEXT run puts them back. Whatever
// kills this process — Ctrl-C, a CI timeout, an OOM, the power — the tree heals on the next
// invocation instead of shipping a dead check inside an unrelated commit (E-108).
const JOURNAL = f('tests/mutation/.in-flight.json');

function healFromJournal() {
  if (!fs.existsSync(JOURNAL)) return;
  try {
    const { file, orig } = JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
    fs.writeFileSync(f(file), orig);
    console.error(
      `⚠ a previous run was interrupted mid-mutant — restored ${file} before starting.\n`,
    );
  } catch (err) {
    // Loud, and fatal: a journal we cannot apply means a file may still be mutated, and
    // continuing would run the whole suite against a tree we know is suspect.
    console.error(`✗ could not apply the mutation journal (${JOURNAL}): ${err.message}`);
    console.error('  restore by hand (`git checkout -- <file>`) before re-running.');
    process.exit(1);
  }
  fs.rmSync(JOURNAL, { force: true });
}

function run() {
  healFromJournal();
  const survived = [];
  // THE RESTORE MUST SURVIVE THE PROCESS DYING. `finally` covers a thrown error; it does not
  // cover Ctrl-C, a CI timeout, or a SIGTERM — and one of those is how `if (false)` ended up
  // committed into apocalypse.js inside an unrelated commit (E-108). The mutated file is
  // registered before it is written, and put back by a signal handler as well.
  let inFlight = null;
  const putBack = () => {
    if (!inFlight) return;
    try {
      fs.writeFileSync(inFlight.abs, inFlight.orig);
      fs.rmSync(JOURNAL, { force: true });
    } catch {
      /* the journal survives, so the next run heals it — that is the point of having one */
    }
    console.error(`\n⚠ interrupted — restored ${inFlight.file}`);
    inFlight = null;
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      putBack();
      process.exit(130);
    });
  }
  process.on('uncaughtException', (err) => {
    putBack();
    console.error(err);
    process.exit(1);
  });

  for (const m of MUTANTS) {
    const abs = f(m.file);
    const orig = fs.readFileSync(abs, 'utf8');
    if (!orig.includes(m.find)) {
      console.log(`⚠ target moved — ${m.desc}`);
      survived.push(`${m.desc} (mutation target not found — update the harness)`);
      continue;
    }
    inFlight = { abs, orig, file: m.file };
    // journal FIRST, then mutate — the window where the file is changed and no record of its
    // original exists must be empty
    fs.writeFileSync(JOURNAL, JSON.stringify({ file: m.file, orig }));
    fs.writeFileSync(abs, orig.replace(m.find, m.repl));
    let killed = false;
    try {
      // NOT `npx`: on Windows that is `npx.cmd`, a batch wrapper `execFileSync` cannot start
      // (ENOENT). This harness is a step of the release gate, so the whole publish died there
      // — E-101 fixed the gate and missed the thing the gate calls. `process.execPath` is the
      // same node already running this file: no shell, no PATH lookup, and the vitest the
      // lockfile pins rather than whatever npx would resolve.
      execFileSync(process.execPath, [VITEST, 'run', m.test], {
        cwd: repo,
        stdio: 'ignore',
      });
    } catch {
      killed = true; // the test FAILED under mutation → mutant killed (good)
    } finally {
      fs.writeFileSync(abs, orig); // ALWAYS restore, even on crash
      fs.rmSync(JOURNAL, { force: true });
      inFlight = null;
    }
    console.log(killed ? `✓ killed   — ${m.desc}` : `✗ SURVIVED — ${m.desc}`);
    if (!killed) survived.push(m.desc);
  }

  if (survived.length) {
    console.error(
      `\n✗ ${survived.length}/${MUTANTS.length} mutant(s) SURVIVED — a guarded line has no test that bites:`,
    );
    for (const s of survived) console.error(`    - ${s}`);
    process.exit(1);
  }
  console.log(`\n✓ all ${MUTANTS.length} mutants killed — the guardian tests bite.`);
}

// Importing this file must not RUN it: `tests/no-mutant-left-behind.test.js` reads `MUTANTS` in
// the ordinary suite, and without this guard that import would launch all 128 mutants — each of
// which spawns vitest, recursively. Placed last on purpose: `run()` closes over `JOURNAL`, and
// calling it above that `const` is a temporal-dead-zone crash.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) run();
