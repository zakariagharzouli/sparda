// ubg/express-router-value.js — is this module a statically created Express Router?
//
// `app.use('/api', routes)` has worked since the first Express lowering: a string
// first argument means "mount", and everything under it is scanned. `app.use(routes)`
// — the same router, mounted at the root — did not, because the mount branch is
// only reached when the first argument is a StringLiteral. The router value fell
// through to the unpathed-middleware loop, `resolveCallable` accepted it, and the
// entire route tree became one middleware named `routes`.
//
// MEASURED on this fixture shape before the change: `app.use('/', routes)` yields 6
// routes; `app.use(routes)` yields 0 routes, 0 skipped surfaces and 0 boundaries.
// Not a wrong answer — no answer, and no trace that one was missing.
//
// This module supplies the ONE discriminator that was absent: does the required
// module statically export an Express Router? Nothing else changes. When the answer
// is yes the existing mount machinery does the rest — nested
// `router.use('/prefix', require('./child'))` and literal leaves were already
// handled, and are reused rather than reimplemented.
//
// A ROUTER IS NOT A MIDDLEWARE, and that asymmetry is why the check has to be this
// one and not "is it required from a relative path". A module exporting a function
// keeps its current treatment exactly — turning a middleware into a mount would
// move guard credit, which this slice may not do.
//
// Everything unproved stays UNKNOWN and DECLARED: a dynamic or bare `require`, an
// object/function export, an unresolved file, a cycle, a computed member, a router
// this walk cannot see created statically.
import fs from 'node:fs';
import { parseModule } from './extract.js';

// The express factory, and the two shapes a router is created in.
const EXPRESS_PKG = 'express';

// Why a module was refused. Closed, so the ledger can aggregate by cause.
export const ROUTER_VALUE_REFUSALS = Object.freeze({
  UNRESOLVED_FILE: 'the required file did not resolve',
  UNREADABLE: 'the module did not parse',
  NO_MODULE_EXPORTS: 'no program-scope `module.exports = <identifier>`',
  EXPORT_NOT_IDENTIFIER: 'module.exports is not a plain identifier binding',
  NOT_A_ROUTER: 'the exported binding is not a statically created Express Router',
  EXPORTS_FUNCTION:
    'the module exports a function — ordinary middleware, already modelled',
});

const FUNCTION_NODES = new Set([
  'FunctionExpression',
  'ArrowFunctionExpression',
  'FunctionDeclaration',
]);

// The raw specifier of `const <local> = require('<spec>')` at program scope, or
// null. Read from the AST rather than from the resolved import map, because the
// question is what was WRITTEN: `require('express')` is the express package, and a
// local file that happens to export a `Router` is not.
function requireSpecifierOf(mod, local) {
  for (const node of mod?.ast?.program?.body ?? []) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) {
      const init = d.init;
      if (
        init?.type !== 'CallExpression' ||
        init.callee?.type !== 'Identifier' ||
        init.callee.name !== 'require' ||
        init.arguments[0]?.type !== 'StringLiteral'
      )
        continue;
      // `const express = require('express')`
      if (d.id?.type === 'Identifier' && d.id.name === local)
        return { spec: init.arguments[0].value, destructured: null };
      // `const { Router } = require('express')`
      if (d.id?.type === 'ObjectPattern')
        for (const p of d.id.properties)
          if (
            p.type === 'ObjectProperty' &&
            !p.computed &&
            p.key?.type === 'Identifier' &&
            p.value?.type === 'Identifier' &&
            p.value.name === local
          )
            return { spec: init.arguments[0].value, destructured: p.key.name };
    }
  }
  return null;
}

// `require('express')` written inline, as an expression.
const isExpressRequireCall = (node) =>
  node?.type === 'CallExpression' &&
  node.callee?.type === 'Identifier' &&
  node.callee.name === 'require' &&
  node.arguments[0]?.type === 'StringLiteral' &&
  node.arguments[0].value === EXPRESS_PKG;

// Is this call expression a statically created Express router?
//   express.Router()            — `express` bound by require('express')
//   Router()                    — `Router` destructured from require('express')
//   require('express').Router() — the chained form, which is what the pinned
//                                 external source actually writes. Measuring it
//                                 rather than assuming the shape is the difference
//                                 between 11 declared refusals and 11 routes.
function isRouterFactory(init, mod) {
  if (init?.type !== 'CallExpression') return false;
  const callee = init.callee;
  if (callee?.type === 'MemberExpression') {
    if (callee.computed) return false; // a computed member is not a proved factory
    if (callee.property?.type !== 'Identifier' || callee.property.name !== 'Router')
      return false;
    if (isExpressRequireCall(callee.object)) return true;
    if (callee.object?.type !== 'Identifier') return false;
    return requireSpecifierOf(mod, callee.object.name)?.spec === EXPRESS_PKG;
  }
  if (callee?.type === 'Identifier') {
    const bound = requireSpecifierOf(mod, callee.name);
    return bound?.spec === EXPRESS_PKG && bound.destructured === 'Router';
  }
  return false;
}

// The identifier `module.exports` is assigned at program scope, or null.
function moduleExportsIdentifier(mod) {
  let name = null;
  for (const node of mod?.ast?.program?.body ?? []) {
    if (node.type !== 'ExpressionStatement') continue;
    const a = node.expression;
    if (
      a?.type !== 'AssignmentExpression' ||
      a.operator !== '=' ||
      a.left?.type !== 'MemberExpression' ||
      a.left.computed ||
      a.left.object?.type !== 'Identifier' ||
      a.left.object.name !== 'module' ||
      a.left.property?.type !== 'Identifier' ||
      a.left.property.name !== 'exports'
    )
      continue;
    // The LAST assignment wins, exactly as it does at runtime. `null` when the
    // final one is not a plain identifier — an object literal, a call, a function.
    name = a.right?.type === 'Identifier' ? a.right.name : null;
  }
  return name;
}

// → { router: true, file } when the module statically exports an Express Router,
// or { router: false, reason } naming why not. Never throws, never guesses.
//
// It inspects exactly ONE module and does not traverse: composing the children is
// the existing mount machinery's job, and that is also where a require CYCLE is
// bounded and declared (`mount depth limit … left unscanned`). A cycle guard here
// would be decorative — unreachable, and therefore unkillable by any mutant.
export function exportsExpressRouter(file) {
  if (!file) return { router: false, reason: ROUTER_VALUE_REFUSALS.UNRESOLVED_FILE };
  if (!fs.existsSync(file))
    return { router: false, reason: ROUTER_VALUE_REFUSALS.UNRESOLVED_FILE };

  const mod = parseModule(file);
  if (!mod || mod.error)
    return { router: false, reason: ROUTER_VALUE_REFUSALS.UNREADABLE };

  const exported = moduleExportsIdentifier(mod);
  if (exported === null) {
    // Distinguish "there is no module.exports at all" from "there is one and it is
    // not an identifier": the second is the object-export negative, and collapsing
    // them would make the ledger unable to say which shape it met.
    const hasAssignment = (mod.ast?.program?.body ?? []).some(
      (n) =>
        n.type === 'ExpressionStatement' &&
        n.expression?.type === 'AssignmentExpression' &&
        n.expression.left?.type === 'MemberExpression' &&
        n.expression.left.object?.type === 'Identifier' &&
        n.expression.left.object.name === 'module',
    );
    // `module.exports = function requireAuth(...)` is ORDINARY MIDDLEWARE, which
    // the Express lowering already models. Saying so explicitly is what keeps the
    // ledger readable: declaring every middleware in every application as an
    // unproved router would bury the handful of real refusals.
    if (hasAssignment && exportsFunctionValue(mod))
      return {
        router: false,
        callable: true,
        reason: ROUTER_VALUE_REFUSALS.EXPORTS_FUNCTION,
      };
    return {
      router: false,
      reason: hasAssignment
        ? ROUTER_VALUE_REFUSALS.EXPORT_NOT_IDENTIFIER
        : ROUTER_VALUE_REFUSALS.NO_MODULE_EXPORTS,
    };
  }

  for (const node of mod.ast.program.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) {
      if (d.id?.type !== 'Identifier' || d.id.name !== exported) continue;
      if (isRouterFactory(d.init, mod)) return { router: true, file };
    }
  }
  // an identifier bound to a function is middleware too, by the same reasoning
  for (const node of mod.ast.program.body) {
    if (node.type === 'FunctionDeclaration' && node.id?.name === exported)
      return {
        router: false,
        callable: true,
        reason: ROUTER_VALUE_REFUSALS.EXPORTS_FUNCTION,
      };
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations)
      if (
        d.id?.type === 'Identifier' &&
        d.id.name === exported &&
        FUNCTION_NODES.has(d.init?.type)
      )
        return {
          router: false,
          callable: true,
          reason: ROUTER_VALUE_REFUSALS.EXPORTS_FUNCTION,
        };
  }
  return { router: false, reason: ROUTER_VALUE_REFUSALS.NOT_A_ROUTER };
}

// `module.exports = function (...) {}` / `= (req,res,next) => {}`
function exportsFunctionValue(mod) {
  for (const node of mod?.ast?.program?.body ?? []) {
    if (node.type !== 'ExpressionStatement') continue;
    const a = node.expression;
    if (
      a?.type === 'AssignmentExpression' &&
      a.left?.type === 'MemberExpression' &&
      a.left.object?.type === 'Identifier' &&
      a.left.object.name === 'module' &&
      FUNCTION_NODES.has(a.right?.type)
    )
      return true;
  }
  return false;
}

// Was this `app.use` argument written as a required MODULE — `require('./x')`
// inline, or an identifier bound by one at program scope? Only those are candidate
// router mounts. A local string, a config value or an inline `express.static(...)`
// is not a module this grammar refused; it is not a module at all, and declaring
// it would drown the ledger in noise on every real application.
export function isRequiredModuleArg(arg, mod) {
  if (
    arg?.type === 'CallExpression' &&
    arg.callee?.type === 'Identifier' &&
    arg.callee.name === 'require'
  )
    return true;
  if (arg?.type !== 'Identifier') return false;
  return requireSpecifierOf(mod, arg.name) !== null;
}
