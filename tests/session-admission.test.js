import { parse } from '@babel/parser';
import { describe, it, expect } from 'vitest';
import { sessionAdmission } from '../src/ubg/session-admission.js';
const read = (source) =>
  sessionAdmission(parse(`(${source})`).program.body[0].expression);
describe('session admission is a bounded condition, not authorization', () => {
  it('reads parameter identities and a positive truthy branch', () => {
    expect(
      read(
        '(request,response,proceed)=>{if(request.session.actor){return proceed();}console.log("denied");return response.redirect("/login");}',
      ),
    ).toEqual({
      schema: 'session-admission/v1',
      origin: 'session',
      name: 'actor',
      condition: 'truthy',
      rejection: 'returns-without-next',
      authorizationProven: null,
    });
  });
  it('reads a negative branch with an explicit denial status', () => {
    expect(
      read('(r,s,n)=>{if(!r.session.subject)return s.sendStatus(403);return n();}').name,
    ).toBe('subject');
  });
  it.each([
    [
      'asynchronous',
      'async(r,s,n)=>{if(r.session.actor)return n();return s.redirect("/");}',
    ],
    [
      'rest parameter',
      '(r,s,...n)=>{if(r.session.actor)return n();return s.redirect("/");}',
    ],
    [
      'two parameters',
      '(r,s)=>{if(r.session.actor)return next();return s.redirect("/");}',
    ],
    [
      'unrelated request',
      '(r,s,n)=>{if(other.session.actor)return n();return s.redirect("/");}',
    ],
    [
      'query is not session',
      '(r,s,n)=>{if(r.query.actor)return n();return s.redirect("/");}',
    ],
    [
      'nested unknown identity',
      '(r,s,n)=>{if(r.session.user.id)return n();return s.redirect("/");}',
    ],
    [
      'computed property',
      '(r,s,n)=>{if(r.session[key])return n();return s.redirect("/");}',
    ],
    [
      'foreign continuation',
      '(r,s,n)=>{if(r.session.actor)return proceed();return s.redirect("/");}',
    ],
    [
      'continuation argument',
      '(r,s,n)=>{if(r.session.actor)return n(error);return s.redirect("/");}',
    ],
    [
      'continuation not returned',
      '(r,s,n)=>{if(r.session.actor)n();return s.redirect("/");}',
    ],
    ['both branches pass', '(r,s,n)=>{if(r.session.actor)return n();return n();}'],
    [
      'foreign response',
      '(r,s,n)=>{if(r.session.actor)return n();return other.redirect("/");}',
    ],
    [
      'computed redirect',
      '(r,s,n)=>{if(r.session.actor)return n();return s.redirect(destination); }',
    ],
    [
      'successful response',
      '(r,s,n)=>{if(!r.session.actor)return s.sendStatus(200);return n();}',
    ],
    [
      'side effect',
      '(r,s,n)=>{if(r.session.actor){grant();return n();}return s.redirect("/");}',
    ],
    [
      'log argument executes code',
      '(r,s,n)=>{if(r.session.actor)return n();console.log(n());return s.redirect("/");}',
    ],
    [
      'explicit unknown else',
      '(r,s,n)=>{if(r.session.actor)return n();else return s.redirect("/");return n();}',
    ],
    [
      'compound predicate',
      '(r,s,n)=>{if(r.session.actor && r.session.admin)return n();return s.redirect("/");}',
    ],
    [
      'oversized body',
      '(r,s,n)=>{if(r.session.actor)return n();console.log("a");console.log("b");console.log("c");return s.redirect("/");}',
    ],
  ])('declines %s', (_label, source) => expect(read(source)).toBeNull());
  it('does not interpret absent or malformed bodies', () => {
    expect(sessionAdmission(null)).toBeNull();
    expect(read('(r,s,n)=>n()')).toBeNull();
  });
});
