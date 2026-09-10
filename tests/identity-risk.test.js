import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { compileUBG } from '../src/ubg/compile.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import {
  identityRiskFindings,
  attachIdentityRiskEvidence,
} from '../src/ubg/identity-risk.js';
let dir;
afterEach(() => {
  if (dir) {
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('sparda-identity-')
    )
      throw Error('unsafe test cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});
const auth = '(r,s,n)=>{if(r.session.actor){return n();}return s.redirect("/login");}';
function compile({
  gate = auth,
  extra = '',
  selector = 'req.params.actor',
  before = '',
  pathName = '/records/:actor',
  withGate = true,
  gateFactory = false,
} = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-identity-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { express: '5.2.1', mongodb: '6.0.0' } }),
  );
  fs.writeFileSync(
    path.join(dir, 'records.js'),
    `
    function Records(db){ const rows=db.collection('records');
      this.read=(req,res)=>{${before} const actor=${selector};rows.find({_id:actor}).toArray((err,values)=>res.json(values));};
    }
    module.exports=Records;
  `,
  );
  fs.writeFileSync(
    path.join(dir, 'gates.js'),
    `function Gates(){this.admit=${gate};}module.exports=Gates;`,
  );
  fs.writeFileSync(
    path.join(dir, 'app.js'),
    `
    const express=require('express'); const {MongoClient}=require('mongodb');const Records=require('./records');
    const app=express(); const db=new MongoClient('mongodb://localhost').db('app');
    const controller=new Records(db);${gateFactory ? "const Gates=require('./gates');const holder=new Gates();const gate=holder.admit;" : `const gate=${gate};`}
    app.get('${pathName}',${withGate ? 'gate,' : ''}${extra}controller.read);app.listen(3000);
  `,
  );
  const result = compileUBG(dir, { write: false }),
    graph = JSON.parse(result.json);
  return {
    result,
    graph,
    findings: checkGraph(graph).findings.filter(
      (f) => f.rule === 'CLIENT_SELECTED_IDENTITY',
    ),
  };
}
describe('automatic identity divergence risk, end to end', () => {
  it('joins a constructor-owned middleware through its actual registration', () => {
    expect(compile({ gateFactory: true }).findings).toHaveLength(1);
  });
  it.each([
    'role',
    'state',
    'path',
    'origin',
    'field',
    'operator',
    'nested-destination',
    'symbolic',
    'table',
    'scope',
    'owner',
    'effect',
    'reach',
    'framework',
    'budget',
  ])('does not attach evidence with a broken %s premise', (which) => {
    const { result } = compile(),
      graph = result.graph;
    const ep = [...graph.nodes.values()].find((n) => n.meta.identityRiskEvidence);
    delete ep.meta.identityRiskEvidence;
    let facts = structuredClone(result.report.kernel.facts);
    const p = facts.find(
      (f) => f.kind === 'DataFlowPath' && f.entrypoint === ep.id && f.role === 'filter',
    );
    const o = facts.find(
      (f) => f.kind === 'DbEffectOccurrence' && f.entrypoint === ep.id,
    );
    if (which === 'role') p.role = 'data';
    if (which === 'state') p.state = 'unknown';
    if (which === 'path') p.path = null;
    if (which === 'origin') p.source.origin = 'session';
    if (which === 'field') p.source.name = 'other';
    if (which === 'operator') p.destination = 'filter.$where';
    if (which === 'nested-destination') p.destination = 'filter.nested.actor';
    if (which === 'symbolic') o.symbolicTarget = true;
    if (which === 'table') o.table = null;
    if (which === 'scope') o.ownerScoped = true;
    if (which === 'owner') o.owner = 'different-body';
    if (which === 'effect') {
      o.effect = 'missing';
      p.effect = 'missing';
    }
    if (which === 'reach') graph.edges = graph.edges.filter((e) => e.to !== p.effect);
    if (which === 'framework') graph.meta.framework = 'nestjs';
    if (which === 'budget')
      facts = facts.concat(Array(200001 - facts.length).fill({ kind: 'Unrelated' }));
    attachIdentityRiskEvidence(graph, facts);
    expect(ep.meta.identityRiskEvidence).toBeUndefined();
  });
  it('flags a route-local client selector without claiming a policy or exploit', () => {
    const { findings } = compile();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'high',
      advisory: false,
      classification: 'risk-candidate',
      authorizationViolation: null,
      exploitability: null,
    });
    expect(findings[0].identityEvidence[0]).toMatchObject({
      source: { origin: 'params', name: 'actor' },
      session: 'actor',
      table: 'records',
    });
    expect(findings[0].assumptions).toHaveLength(2);
  });
  it('accepts the equivalent negative admission form', () => {
    expect(
      compile({
        gate: '(r,s,n)=>{if(!r.session.actor)return s.sendStatus(401);return n();}',
      }).findings,
    ).toHaveLength(1);
  });
  it.each([
    ['session-derived target', { selector: 'req.session.actor' }],
    ['unrelated parameter', { selector: 'req.params.record' }],
    ['constant target', { selector: '42' }],
    ['public route', { withGate: false }],
    [
      'additional role gate',
      { extra: '(r,s,n)=>{if(!r.session.admin)return s.sendStatus(403);return n();},' },
    ],
    [
      'inline ownership comparison',
      { before: 'if(req.params.actor!==req.session.actor)return res.sendStatus(403);' },
    ],
    ['opaque selector', { selector: 'chooseTarget(req.params.actor,req.session.actor)' }],
    [
      'compound session policy',
      {
        gate: '(r,s,n)=>{if(r.session.actor&&r.session.admin)return n();return s.redirect("/");}',
      },
    ],
    ['empty middleware', { gate: '(r,s,n)=>n()' }],
  ])('does not raise the new risk for %s', (_name, options) =>
    expect(compile(options).findings).toEqual([]),
  );
  it('keeps a potentially legitimate shared directory conditional', () => {
    const { findings } = compile({ pathName: '/directory/:actor' });
    expect(findings).toHaveLength(1);
    expect(findings[0].authorizationViolation).toBeNull();
    expect(findings[0].assumptions[1]).toContain('sharing');
  });
  it('declines a registered third step even without a recognized policy guard', () => {
    const { graph } = compile();
    const ep = graph.nodes.find((n) => n.meta.identityRiskEvidence);
    const extra = { id: 'extra-step', kind: 'logic', meta: {} };
    graph.nodes.push(extra);
    graph.edges.push({
      from: ep.id,
      to: extra.id,
      kind: 'control_flow',
      meta: { route: ep.id, order: 2 },
    });
    expect(identityRiskFindings(ep, graph.nodes, graph.edges)).toEqual([]);
  });
  it('declines an inline denial even when no separate guard node is emitted', () => {
    const { graph } = compile();
    const ep = graph.nodes.find((n) => n.meta.identityRiskEvidence);
    const handler = graph.nodes.find(
      (n) =>
        n.id ===
        graph.edges.find((e) => e.meta?.route === ep.id && e.meta.order === 1).to,
    );
    handler.meta.bodyDenies = true;
    expect(identityRiskFindings(ep, graph.nodes, graph.edges)).toEqual([]);
  });
  it('does not let names or source comments decide the finding', () => {
    expect(
      compile({
        pathName: '/public-admin-share/:actor',
        before: '/* This comment is not a reviewed access policy. */',
      }).findings,
    ).toHaveLength(1);
  });
  it('never upgrades session authentication to a verified authorization guard', () => {
    const { graph } = compile();
    const node = graph.nodes.find((n) => n.meta.sessionAdmission);
    expect(node.meta.sessionAdmission.authorizationProven).toBeNull();
    expect(node.meta.verified).not.toBe(true);
  });
  it.each(['guard', 'session', 'source', 'effect', 'scope'])(
    'rejects stale %s evidence when regrading a changed graph',
    (which) => {
      const { graph } = compile(),
        ep = graph.nodes.find((n) => n.meta.identityRiskEvidence);
      const evidence = ep.meta.identityRiskEvidence[0];
      if (which === 'guard') evidence.guard = 'missing';
      if (which === 'session') {
        evidence.session = 'other';
        evidence.source.name = 'other';
      }
      if (which === 'source') evidence.source.origin = 'session';
      if (which === 'effect') evidence.effect = 'missing';
      if (which === 'scope')
        graph.nodes.find((n) => n.id === evidence.effect).meta.ownerScoped = true;
      expect(identityRiskFindings(ep, graph.nodes, graph.edges)).toEqual([]);
    },
  );
});
