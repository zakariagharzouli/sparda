import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parseExpression } from '@babel/parser';
import { afterEach, describe, expect, it } from 'vitest';
import { admissionCondition } from '../src/ubg/admission-condition.js';
import { checkSourceAuthorization } from '../src/ubg/source-authorization.js';
import { compileUBG } from '../src/ubg/compile.js';
import { extractExpress } from '../src/ubg/express.js';
import { clearModuleCache } from '../src/ubg/extract.js';
import { solveBoolean } from '../src/ubg/boolean-solver.js';
import { sourceHashOf } from '../src/ubg/serialize.js';

const dirs = [],
  parse = (source) => parseExpression(source, { plugins: ['typescript'] });
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (!dir.startsWith(path.join(os.tmpdir(), 'sparda-source-auth-')))
      throw Error('cleanup boundary');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function project(guard, extra = '', extension = 'js') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-source-auth-'));
  dirs.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: { express: '4.0.0' }, main: `app.${extension}` }),
  );
  fs.writeFileSync(
    path.join(root, `app.${extension}`),
    `const express = require('express');\nconst app = express();\nconst guard = ${guard};\n${extra}\napp.post('/items', guard, (req,res)=>res.send('done'));\nmodule.exports=app;\n`,
  );
  return root;
}
function policyFor(graph, allowed = 'session.admin') {
  return {
    schema: 'sparda-source-authorization/v1',
    basis: 'Explicit test policy: handler requires admin',
    sourceHash: graph.meta.sourceHash,
    rules: [{ entrypoint: 'entrypoint:POST /items', allowed }],
  };
}
function compiled(root, allowed) {
  const baseline = compileUBG(root, { write: false }),
    policy = policyFor(JSON.parse(baseline.json), allowed);
  return {
    baseline,
    policy,
    result: compileUBG(root, { write: false, sourceAuthorizationPolicy: policy }),
  };
}

describe('source condition versus independently executed authored middleware', () => {
  it.each([
    '(r,s,n)=>{if(!r.session.admin)return s.sendStatus(403);return n();}',
    '(r,s,n)=>{if(r.session.admin)return s.sendStatus(403);else return n();}',
    '(r,s,n)=>{if(!r.session.admin)return s.sendStatus(403);if(!r.session.owner)return s.sendStatus(403);return n();}',
  ])('agrees with executions where the alternate path admits: %s', (source) => {
    const result = admissionCondition(parse(source));
    expect(result.conditionExtracted).toBe(true);
    for (const admin of [false, true])
      for (const owner of [false, true]) {
        const sandbox = { session: { admin, owner }, calls: 0 };
        vm.runInNewContext(
          `(${source})({session},{sendStatus(){}},()=>calls++);`,
          sandbox,
          { timeout: 1000 },
        );
        const fixed = [
          'and',
          result.formula,
          admin ? 'session.admin' : ['not', 'session.admin'],
          owner ? 'session.owner' : ['not', 'session.owner'],
        ];
        expect(solveBoolean(fixed).status).toBe(sandbox.calls ? 'SAT' : 'UNSAT');
      }
  });
  it('does not confuse falling off middleware with invoking next', () => {
    const result = admissionCondition(parse('(r,s,n)=>{if(r.session.admin)return n();}'));
    expect(solveBoolean(['and', result.formula, ['not', 'session.admin']]).status).toBe(
      'UNSAT',
    );
  });
  it('uses JavaScript truthiness rather than equality to true', () => {
    const source =
      '(req,res,next)=>{if(req.session.admin)return next();return res.sendStatus(403);}';
    const admission = admissionCondition(parse(source));
    for (const admin of [false, true, null, undefined, 0, 1, '', 'false', [], {}]) {
      const sandbox = { session: { admin }, calls: 0 };
      vm.runInNewContext(
        `(${source})({session}, {sendStatus(){}}, ()=>calls++);`,
        sandbox,
        { timeout: 1000 },
      );
      expect(
        solveBoolean([
          'and',
          admission.formula,
          admin ? 'session.admin' : ['not', 'session.admin'],
        ]).status,
      ).toBe(sandbox.calls ? 'SAT' : 'UNSAT');
    }
  });
  it('matches 256 executions of generated Boolean guards, with real short-circuit behavior', () => {
    const predicates = [
      'req.session.admin',
      'req.session.owner',
      '!req.session.admin',
      '(req.session.admin && req.session.owner)',
      '(req.session.admin || req.session.owner)',
      '!(req.session.admin && req.session.owner)',
      '!(req.session.admin || req.session.owner)',
      'true',
    ];
    let executions = 0;
    for (const a of predicates)
      for (const b of predicates) {
        const source = `(req,res,next)=>{if(${a}){if(${b})return next();return res.sendStatus(403);}return res.redirect('/login');}`;
        const admission = admissionCondition(parse(source));
        expect(admission.conditionExtracted).toBe(true);
        for (const admin of [false, true])
          for (const owner of [false, true]) {
            const sandbox = { session: { admin, owner }, calls: 0 };
            vm.runInNewContext(
              `(${source})({session}, {sendStatus(){},redirect(){}}, ()=>calls++);`,
              sandbox,
              { timeout: 1000 },
            );
            const fixed = [
              'and',
              admission.formula,
              admin ? 'session.admin' : ['not', 'session.admin'],
              owner ? 'session.owner' : ['not', 'session.owner'],
            ];
            expect(solveBoolean(fixed).status).toBe(
              sandbox.calls === 1 ? 'SAT' : 'UNSAT',
            );
            executions++;
          }
      }
    expect(executions).toBe(256);
  });
  it.each([
    '(req,res,next)=>{if(!req.session.admin)return res.sendStatus(403);return next();}',
    '(req,res,next)=>{if(req.session.admin)return next();}',
    '(req,res,next)=>next()',
    '(req: Request,res: Response,next: NextFunction)=>{if(req.session.admin)return next();return res.sendStatus(401);}',
  ])('reads admitted JS/TS control flow: %s', (source) =>
    expect(admissionCondition(parse(source)).conditionExtracted).toBe(true),
  );
  it.each([
    'async(req,res,next)=>next()',
    '(req,res)=>next()',
    '(req,res,next)=>{req.session.admin=true;return next();}',
    '(req,res,next)=>{if(isAdmin(req))return next();return res.sendStatus(403);}',
    '(req,res,next)=>{if(req.query.admin)return next();}',
    '(req,res,next)=>{if(req.session["admin"])return next();}',
    '(req,res,next)=>{if(req.session.admin === "true")return next();}',
    '(req,res,next)=>{if(req?.session?.admin)return next();}',
    '(req,res,next)=>{next();return res.sendStatus(403);}',
    '(req,res,next)=>{return next("route");}',
    '(req,res,next)=>{throw Error("denied");}',
    '(req,res,next)=>{try{return next();}finally{return res.sendStatus(403);}}',
    '(req,res,next)=>{while(req.session.admin)return next();}',
    '(req,res,next)=>{if(req.session.admin)return next();console.log("denied");return res.sendStatus(403);}',
  ])('declines unsupported behavior: %s', (source) => {
    expect(admissionCondition(parse(source))).toMatchObject({
      conditionExtracted: null,
      formula: null,
      authorizationViolation: null,
    });
  });
  it('bounds nested control flow', () => {
    const source = `(r,s,n)=>{${'if(r.session.admin){'.repeat(30)}return n();${'}'.repeat(30)}}`;
    expect(admissionCondition(parse(source)).conditionExtracted).toBeNull();
    const wide = `(r,s,n)=>{${'{{}}'.repeat(40)}return n();}`;
    expect(admissionCondition(parse(wide)).conditionExtracted).toBeNull();
  });
});

describe('actual compilation to source-bound Boolean obligations', () => {
  it('declines even duplicate registrations that collapse to the same graph edges', () => {
    const root = project(
      '(r,s,n)=>n()',
      "const handler=(r,s)=>s.send('done');\napp.post('/items',guard,handler);",
    );
    const file = path.join(root, 'app.js');
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace("(req,res)=>res.send('done')", 'handler'),
    );
    expect(compiled(root).result.report.sourceAuthorization.checks[0].reason).toBe(
      'ambiguous-or-missing-route',
    );
  });
  it('declines global middleware until its registration ordering is certified', () => {
    const root = project('(r,s,n)=>n()');
    fs.appendFileSync(path.join(root, 'app.js'), 'app.use((r,s,n)=>n());\n');
    expect(compiled(root).result.report.sourceAuthorization.checks[0].reason).toBe(
      'global-middleware-unmeasured',
    );
  });
  it('rejects an operator changed on disk even when predicate positions are unchanged', () => {
    const root = project(
      '(r,s,n)=>{if(r.session.admin && r.session.owner)return n();return s.sendStatus(403);}',
    );
    const { baseline, policy, result } = compiled(root),
      graph = JSON.parse(baseline.json);
    const files = result.report.sourceAuthorization.compilationFiles;
    clearModuleCache();
    const extracted = extractExpress(root, 'app.js');
    const file = path.join(root, 'app.js');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(' && ', ' || '));
    graph.meta.sourceHash = sourceHashOf(root, files);
    expect(
      checkSourceAuthorization(
        root,
        graph,
        extracted,
        { ...policy, sourceHash: graph.meta.sourceHash },
        files,
      ).checks[0].reason,
    ).toBe('source-body-mismatch');
  });
  it('preserves UNKNOWN for mixed measured/unmeasured rules and malformed contracts', () => {
    const root = project('(r,s,n)=>n()'),
      { baseline, policy, result } = compiled(root);
    const graph = JSON.parse(baseline.json),
      files = result.report.sourceAuthorization.compilationFiles;
    clearModuleCache();
    const extracted = extractExpress(root, 'app.js');
    const mixed = {
      ...policy,
      rules: [
        ...policy.rules,
        { entrypoint: 'entrypoint:POST /missing', allowed: 'session.admin' },
      ],
    };
    expect(checkSourceAuthorization(root, graph, extracted, mixed, files)).toMatchObject({
      status: 'UNKNOWN',
      modelSatisfiable: null,
      conditionExtracted: null,
    });
    for (const invalid of [
      { ...policy, basis: '' },
      { ...policy, extra: 'undeclared' },
      { ...policy, rules: [] },
      { ...policy, rules: new Array(1) },
      { ...policy, rules: Array(33).fill(policy.rules[0]) },
    ])
      expect(
        checkSourceAuthorization(root, graph, extracted, invalid, files).modelSatisfiable,
      ).toBeNull();
    expect(
      checkSourceAuthorization(
        root,
        { ...graph, meta: { ...graph.meta, framework: 'nestjs' } },
        extracted,
        policy,
        files,
      ).reason,
    ).toBe('unsupported-framework');
    const conditional = structuredClone(extracted);
    conditional.routes[0].conditional = true;
    expect(
      checkSourceAuthorization(root, graph, conditional, policy, files).modelSatisfiable,
    ).toBeNull();
    const unscanned = { ...extracted, scannedFiles: [] };
    expect(
      checkSourceAuthorization(root, graph, unscanned, policy, files).checks[0].reason,
    ).toBe('unscanned-body');
  });
  it('conjoins consecutive middleware conditions in registration order', () => {
    const root = project(
      '(r,s,n)=>{if(r.session.loggedIn)return n();return s.sendStatus(403);}',
      'const second=(r,s,n)=>{if(r.session.admin)return n();return s.sendStatus(403);};',
    );
    const file = path.join(root, 'app.js');
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace("'/items', guard,", "'/items', guard, second,"),
    );
    const check = compiled(root).result.report.sourceAuthorization.checks[0];
    expect(check.conditions).toHaveLength(2);
    expect(check.status).toBe('UNSAT');
  });
  it('models entry to a handler with no preceding middleware without claiming its effects', () => {
    const root = project('(r,s,n)=>n()'),
      file = path.join(root, 'app.js');
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace("'/items', guard,", "'/items',"),
    );
    expect(compiled(root).result.report.sourceAuthorization.checks[0]).toMatchObject({
      status: 'SAT',
      path: true,
      conditions: [],
      authorizationViolation: null,
      scope: 'handler-entry-only',
    });
  });
  it('extracts a missing-role counterexample, preserves default graph/report, and hashes byte provenance', () => {
    const root = project(
      '(r,s,n)=>{if(r.session.loggedIn)return n();return s.sendStatus(403);}',
    );
    const { baseline, result } = compiled(root);
    expect(result.json).toBe(baseline.json);
    const { sourceAuthorization, ...ordinary } = result.report;
    expect(ordinary).toEqual(baseline.report);
    expect(sourceAuthorization).toMatchObject({
      status: 'MEASURED',
      modelSatisfiable: true,
      authorizationViolation: null,
    });
    const c = sourceAuthorization.checks[0];
    expect(c).toMatchObject({
      status: 'SAT',
      conditionExtracted: true,
      scope: 'handler-entry-only',
      certificateVerified: true,
      authorizationViolation: null,
    });
    const bytes = fs.readFileSync(path.join(root, 'app.js')),
      source = c.conditions[0].source;
    expect(source.fileHash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(source.bodyHash).toBe(
      createHash('sha256')
        .update(bytes.subarray(source.byteStart, source.byteEnd))
        .digest('hex'),
    );
    expect(c.assumptions).toContain('terminal-handler-and-effect-feasibility-unmeasured');
  });
  it('shows a blocked counterexample when the code actually requires the role', () => {
    const root = project(
      '(r,s,n)=>{if(r.session.loggedIn && r.session.admin)return n();return s.sendStatus(403);}',
    );
    expect(compiled(root).result.report.sourceAuthorization.checks[0]).toMatchObject({
      status: 'UNSAT',
      modelSatisfiable: false,
      authorizationViolation: null,
    });
  });
  it('supports TypeScript source without executing the application', () => {
    const root = project(
      '(r: Request,s: Response,n: NextFunction)=>{if(r.session.admin)return n();return s.sendStatus(403);}',
      '',
      'ts',
    );
    expect(compiled(root).result.report.sourceAuthorization.checks[0].status).toBe(
      'UNSAT',
    );
  });
  it('cannot reuse a policy bound to older source bytes', () => {
    const root = project('(r,s,n)=>n()'),
      { policy } = compiled(root);
    fs.appendFileSync(path.join(root, 'app.js'), '// changed\n');
    expect(
      compileUBG(root, { write: false, sourceAuthorizationPolicy: policy }).report
        .sourceAuthorization.modelSatisfiable,
    ).toBeNull();
  });
  it.each([
    ['global middleware', 'app.use((r,s,n)=>n());'],
    ['duplicate route', "app.post('/items', (r,s)=>s.send('other'));"],
    ['unknown registration', "app[verb]('/mystery',(r,s)=>s.send('x'));"],
  ])('keeps %s unknown', (_name, extra) => {
    const root = project('(r,s,n)=>n()', extra);
    expect(compiled(root).result.report.sourceAuthorization.modelSatisfiable).toBeNull();
  });
  it('keeps an opaque predicate unknown in the real compiler report', () => {
    const root = project('(r,s,n)=>{if(check(r))return n();return s.sendStatus(403);}');
    expect(
      compiled(root).result.report.sourceAuthorization.checks[0].conditionExtracted,
    ).toBeNull();
  });
  it('rejects unsupported policy relations and missing policy', () => {
    const root = project('(r,s,n)=>n()');
    expect(
      compiled(root, 'query.admin').result.report.sourceAuthorization.modelSatisfiable,
    ).toBeNull();
    expect(
      compileUBG(root, { write: false, sourceAuthorizationPolicy: {} }).report
        .sourceAuthorization.modelSatisfiable,
    ).toBeNull();
  });
  it('refuses a corrupted graph projection and a source body changed after extraction', () => {
    const root = project(
      '(r,s,n)=>{if(r.session.admin)return n();return s.sendStatus(403);}',
    );
    const { baseline, policy, result } = compiled(root),
      graph = JSON.parse(baseline.json);
    const compilationFiles = result.report.sourceAuthorization.compilationFiles;
    clearModuleCache();
    const extracted = extractExpress(root, 'app.js');
    const broken = structuredClone(graph);
    for (const edge of broken.edges.filter(
      (e) => e.meta?.route === policy.rules[0].entrypoint,
    ))
      edge.meta.order++;
    expect(
      checkSourceAuthorization(root, broken, extracted, policy, compilationFiles)
        .modelSatisfiable,
    ).toBeNull();
    fs.writeFileSync(
      path.join(root, 'app.js'),
      fs
        .readFileSync(path.join(root, 'app.js'), 'utf8')
        .replace('session.admin', 'session.owner'),
    );
    expect(
      checkSourceAuthorization(root, graph, extracted, policy, compilationFiles)
        .modelSatisfiable,
    ).toBeNull();
    const changed = structuredClone(graph);
    changed.meta.sourceHash = sourceHashOf(root, compilationFiles);
    expect(
      checkSourceAuthorization(
        root,
        changed,
        extracted,
        { ...policy, sourceHash: changed.meta.sourceHash },
        compilationFiles,
      ).checks[0].reason,
    ).toBe('source-body-mismatch');
  });
});
