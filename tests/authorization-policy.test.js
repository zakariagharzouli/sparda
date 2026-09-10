import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAuthorizationPolicy } from '../src/ubg/authorization-policy.js';
import { compileUBG } from '../src/ubg/compile.js';
const ep = 'entrypoint:POST /records';
const sourceHash = 'a'.repeat(64);
const requirement = {
  id: 'selector',
  kind: 'forbid-client-filter',
  entrypoint: ep,
  table: 'records',
  access: 'write',
  source: { origin: 'body', name: 'userId' },
};
const middleware = {
  id: 'role',
  kind: 'require-route-middleware',
  entrypoint: ep,
  middleware: { file: 'auth.js', line: 5, symbol: 'requireRole' },
};
const policy = (requirements = [requirement]) => ({
  schema: 'sparda-authorization-policy/v1',
  id: 'explicit-policy',
  basis: 'Caller-supplied contract, not inferred authorization intent',
  sourceHash,
  requirements,
});
function compilation() {
  return {
    graph: {
      meta: { sourceHash },
      nodes: [
        { id: ep, kind: 'entrypoint' },
        {
          id: 'body',
          kind: 'logic',
          label: 'handler',
          loc: { file: 'app.js', line: 3 },
          meta: {},
        },
        { id: 'effect', kind: 'effect' },
      ],
      edges: [{ kind: 'control_flow', from: ep, to: 'body', meta: { route: ep } }],
    },
    report: {
      kernel: {
        facts: [
          {
            kind: 'DbEffectOccurrence',
            id: 'occurrence',
            entrypoint: ep,
            table: 'records',
            access: 'write',
            effect: 'effect',
            filterOrigins: [{ origin: 'body', name: 'userId' }],
            provenance: { file: 'dao.js', line: 2 },
          },
        ],
      },
    },
  };
}
const check = (c = compilation(), p = policy()) =>
  checkAuthorizationPolicy(c.graph, c.report, p);
describe('explicit authorization policy evidence, separate from automatic detection', () => {
  it('detects a declared forbidden source with route-local evidence', () => {
    const result = check();
    expect(result.status).toBe('violated');
    expect(result.violations).toBe(1);
    expect(result.checks[0].evidence[0].occurrence).toBe('occurrence');
    expect(result.runtimeViolation).toBeNull();
    expect(result.automaticDetection).toBe(false);
  });
  it('does not mutate compilation or policy and is deterministic', () => {
    const c = compilation(),
      p = policy(),
      before = JSON.stringify({ c, p });
    expect(check(c, p)).toEqual(check(c, p));
    expect(JSON.stringify({ c, p })).toBe(before);
  });
  it.each([
    'route',
    'table',
    'access',
    'symbolic',
    'effect',
    'origin',
    'field',
    'absent',
    'session',
  ])('does not invent a forbidden source when %s differs', (which) => {
    const c = compilation(),
      f = c.report.kernel.facts[0];
    if (which === 'route') f.entrypoint = 'entrypoint:POST /other';
    if (which === 'table') f.table = 'other';
    if (which === 'access') f.access = 'read';
    if (which === 'symbolic') f.symbolicTarget = true;
    if (which === 'effect') f.effect = 'missing';
    if (which === 'origin') f.filterOrigins[0].origin = 'query';
    if (which === 'field') f.filterOrigins[0].name = 'other';
    if (which === 'absent') f.filterOrigins = null;
    if (which === 'session') f.filterOrigins[0].origin = 'session';
    expect(check(c)).toMatchObject({
      status: 'unknown',
      violations: null,
      satisfied: null,
    });
  });
  it('requires the route itself to be measured', () => {
    const c = compilation();
    c.graph.nodes.shift();
    expect(check(c).checks[0].reason).toBe('route-unmeasured');
  });
  it('reports a missing explicitly required middleware without claiming a runtime violation', () => {
    const result = check(compilation(), policy([middleware]));
    expect(result.status).toBe('violated');
    expect(result.checks[0].runtimeViolation).toBeNull();
  });
  it.each(['guard', 'logic'])(
    'recognizes an exact registered %s but never certifies its body',
    (kind) => {
      const c = compilation();
      c.graph.nodes.push({
        id: 'gate',
        kind,
        label: 'requireRole',
        loc: { file: 'auth.js', line: 5 },
      });
      c.graph.edges.push({
        kind: 'control_flow',
        from: ep,
        to: 'gate',
        meta: { route: ep },
      });
      expect(check(c, policy([middleware]))).toMatchObject({
        status: 'satisfied',
        satisfied: 1,
        runtimeViolation: null,
      });
    },
  );
  it.each(['file', 'line', 'symbol', 'route'])(
    'does not accept middleware by %s lookalike',
    (which) => {
      const c = compilation(),
        n = {
          id: 'gate',
          kind: 'guard',
          label: 'requireRole',
          loc: { file: 'auth.js', line: 5 },
        };
      if (which === 'file') n.loc.file = 'other.js';
      if (which === 'line') n.loc.line = 6;
      if (which === 'symbol') n.label = 'other';
      c.graph.nodes.push(n);
      c.graph.edges.push({
        kind: 'control_flow',
        from: ep,
        to: 'gate',
        meta: { route: which === 'route' ? 'entrypoint:POST /other' : ep },
      });
      expect(check(c, policy([middleware])).status).toBe('violated');
    },
  );
  it.each(['opaque', 'empty', 'missing-node'])(
    'keeps incomplete %s registration unknown',
    (which) => {
      const c = compilation();
      if (which === 'opaque') c.graph.nodes[1].meta.opaque = true;
      if (which === 'empty') c.graph.edges = [];
      if (which === 'missing-node') c.graph.nodes.splice(1, 1);
      expect(check(c, policy([middleware]))).toMatchObject({
        status: 'unknown',
        violations: null,
        satisfied: null,
      });
    },
  );
  it.each([
    null,
    {},
    { schema: 'wrong' },
    policy([]),
    policy([{ ...requirement, kind: 'invented' }]),
    policy([{ ...requirement, source: { origin: 'session', name: 'userId' } }]),
    policy([requirement, requirement]),
    policy([
      { ...middleware, middleware: { file: '../auth.js', line: 5, symbol: 'gate' } },
    ]),
    { ...policy(), extra: true },
  ])('rejects malformed policy without a passing count', (invalid) => {
    expect(check(compilation(), invalid)).toMatchObject({
      status: 'unknown',
      violations: null,
      satisfied: null,
      policyHash: null,
      runtimeViolation: null,
      automaticDetection: false,
    });
  });
  it('refuses stale source and missing facts', () => {
    expect(check(compilation(), { ...policy(), sourceHash: 'b'.repeat(64) }).reason).toBe(
      'policy-source-mismatch',
    );
    const c = compilation();
    delete c.report.kernel;
    expect(check(c).reason).toBe('missing-compilation-evidence');
  });
  it('bounds policy bytes and evidence size', () => {
    expect(check(compilation(), { ...policy(), basis: 'x'.repeat(65537) }).reason).toBe(
      'policy-byte-budget',
    );
    const c = compilation();
    c.report.kernel.facts = Array(200001).fill({});
    expect(check(c).reason).toBe('evidence-budget');
  });
  it('policy changes alter policy identity, not source identity', () => {
    const a = check(),
      b = check(compilation(), { ...policy(), basis: 'A different explicit assumption' });
    expect(a.policyHash).not.toBe(b.policyHash);
    expect(a.sourceHash).toBe(b.sourceHash);
  });
});
let dir;
afterEach(() => {
  if (dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});
it('is reachable through compileUBG and preserves automatic graph bytes', () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-policy-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { express: '5.2.1' } }),
  );
  fs.writeFileSync(
    path.join(dir, 'app.js'),
    "const express=require('express'); const app=express(); app.post('/records',(req,res)=>res.json({ok:true})); app.listen(3000);",
  );
  const a = compileUBG(dir, { write: false }),
    p = { ...policy([middleware]), sourceHash: a.graph.meta.sourceHash };
  const b = compileUBG(dir, { write: false, authorizationPolicy: p });
  expect(b.json).toBe(a.json);
  expect(a.report.authorizationPolicy).toBeUndefined();
  expect(b.report.authorizationPolicy.status).toBe('violated');
  const stale = compileUBG(dir, { write: false, authorizationPolicy: policy() });
  expect(stale.report.authorizationPolicy.violations).toBeNull();
});
