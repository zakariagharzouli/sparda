import { parse } from '@babel/parser';
import { describe, it, expect } from 'vitest';
import { localReturnPaths } from '../src/ubg/local-return-paths.js';
import { accessPathsForRole, collectReqDerived } from '../src/ubg/extract.js';
import { localFunctions } from '../src/ubg/kernel/bindings.js';
const owner = (code) => parse(`function route(req){${code}}`).program.body[0];
function paths(code) {
  const fn = owner(code),
    role = fn.body.body.at(-1).expression.arguments[0];
  return accessPathsForRole(role, 'filter', {
    reqDerived: collectReqDerived(fn),
    nestedFns: localFunctions(fn),
    localReturnPaths: localReturnPaths(fn),
  });
}
describe('bounded local return alternatives', () => {
  it('carries a source through both return sites without claiming execution', () => {
    const entries = paths(
      'const id=req.params.id; const threshold=req.query.threshold; const make=()=>{if(threshold){return {$where:`${id}:${threshold}`};}return {userId:id};}; sink(make());',
    );
    expect(
      entries
        .filter((e) => e.state === 'resolved')
        .map((e) => [e.origin, e.name, e.dest]),
    ).toEqual([
      ['params', 'id', 'filter.$where'],
      ['params', 'id', 'filter.userId'],
      ['query', 'threshold', 'filter.$where'],
    ]);
    expect(entries.every((e) => e.path.some((s) => s.startsWith('make().return@')))).toBe(
      true,
    );
    expect(entries.find((e) => e.dest === 'filter.$where').path).toContain(
      'template-interpolation',
    );
  });
  it('supports an expression-bodied producer', () => {
    expect(
      paths('const id=req.params.id; const make=()=>({id});sink(make());')[0],
    ).toMatchObject({ state: 'resolved', dest: 'filter.id' });
  });
  it.each([
    ['mutable declaration', 'let make=()=>({id});sink(make());'],
    ['async return', 'const make=async()=>({id});sink(make());'],
    ['parameter ambiguity', 'const make=(id)=>({id});sink(make());'],
    ['call arguments', 'const make=()=>({id});sink(make(other));'],
    ['multiple calls', 'const make=()=>({id});make();sink(make());'],
    ['escaping alias', 'const make=()=>({id});const alias=make;sink(make());'],
    ['reassignment', 'const make=()=>({id});make=other;sink(make());'],
    ['shadowed name', 'const make=()=>({id});{const make=()=>({fixed:1});sink(make());}'],
    ['side effects', 'const make=()=>{mutate();return {id}};sink(make());'],
    ['throw statement', 'const make=()=>{throw id};sink(make());'],
    ['local rebinding', 'const make=()=>{const id=3;return {id}};sink(make());'],
    [
      'predicate call',
      'const make=()=>{if(allowed()){return {id}}return {fixed:1}};sink(make());',
    ],
    ['TDZ call', 'sink(make());const make=()=>({id});'],
  ])('declines %s', (label, code) => {
    expect(localReturnPaths(owner('const id=req.params.id;' + code)).size).toBe(0);
  });
  it('caps producer alternatives and total inspected nodes', () => {
    expect(
      localReturnPaths(
        owner(
          'const make=()=>{' + Array(9).fill('return {id};').join('') + '};sink(make());',
        ),
      ).size,
    ).toBe(0);
    expect(
      localReturnPaths(
        owner(Array(10001).fill(';').join('') + 'const make=()=>({id});sink(make());'),
      ).size,
    ).toBe(0);
  });
  it('returns the same structural map for an immutable function node', () => {
    const fn = owner('const make=()=>({id});sink(make());');
    expect(localReturnPaths(fn)).toBe(localReturnPaths(fn));
  });
  it('keeps opaque return contents unknown', () => {
    expect(
      paths('const id=req.params.id;const make=()=>build(id);sink(make());').every(
        (p) => p.state === 'unknown',
      ),
    ).toBe(true);
  });
});
