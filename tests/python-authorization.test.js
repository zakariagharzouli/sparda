import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkSourceAuthorization } from '../src/ubg/source-authorization.js';
import { extractFastAPI } from '../src/ubg/fastapi.js';
import { createRequire } from 'node:module';
import { Parser, Language } from 'web-tree-sitter';

const require = createRequire(import.meta.url);
const field = (node, name) => node.childForFieldName(name);

function removeFixture(dir) {
  if (
    path.dirname(dir) !== os.tmpdir() ||
    !path.basename(dir).startsWith('sparda-python-auth-')
  )
    throw Error('unexpected fixture');
  fs.rmSync(dir, { recursive: true, force: true });
}
const sourceOf = (
  body,
  dependency = 'Depends',
  extra = '',
) => `from fastapi import FastAPI, Request, Depends, Security, HTTPException
app = FastAPI()
${extra}
async def guard(request: Request):
${body
  .split('\n')
  .map((s) => '    ' + s)
  .join('\n')}
@app.post('/items', dependencies=[${dependency}(guard)])
async def items():
    return {'ok': True}
`;
function fixture(source, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-python-auth-'));
  try {
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'fastapi\n');
    fs.writeFileSync(path.join(dir, 'main.py'), source);
    const base = compileUBG(dir, { write: false });
    const policy = {
      schema: 'sparda-source-authorization/v1',
      basis: 'Authored policy: admin state is required at handler entry.',
      sourceHash: base.graph.meta.sourceHash,
      rules: [{ entrypoint: 'entrypoint:POST /items', allowed: 'state.admin' }],
    };
    return run({ dir, base, policy });
  } finally {
    removeFixture(dir);
  }
}
function measure(source, allowed = 'state.admin') {
  return fixture(source, ({ dir, policy }) => {
    policy.rules[0].allowed = allowed;
    return compileUBG(dir, { write: false, sourceAuthorizationPolicy: policy }).report
      .sourceAuthorization;
  });
}

describe('FastAPI source dependency admission', () => {
  it.each(['Depends', 'Security'])(
    'binds %s guards to a checked UNSAT certificate',
    (dep) => {
      const r = measure(
        sourceOf(
          'if not request.state.admin:\n    raise HTTPException(status_code=403)\nreturn request',
          dep,
        ),
      );
      expect(r.status).toBe('MEASURED');
      expect(r.checks[0].status).toBe('UNSAT');
      expect(r.checks[0].certificateVerified).toBe(true);
      expect(r.checks[0].conditions[0].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(r.authorizationViolation).toBeNull();
    },
  );
  it('produces a counterexample when OR admits a non-admin', () => {
    const r = measure(
      sourceOf(
        'if request.state.admin or request.state.loggedIn:\n    return request\nraise HTTPException(403)',
      ),
    );
    expect(r.checks[0].status).toBe('SAT');
    expect(r.checks[0].certificateVerified).toBe(true);
    expect(r.checks[0].authorizationViolation).toBeNull();
  });
  it('an implicit None or false return still admits the handler', () => {
    for (const body of ['pass', 'return False'])
      expect(measure(sourceOf(body)).checks[0].status).toBe('SAT');
  });
  it('conjoins nested dependencies before checking admission', () => {
    const source = sourceOf(
      'if not request.state.admin:\n    raise HTTPException(403)',
      'Depends',
      'def logged(request: Request):\n    if not request.state.loggedIn:\n        raise HTTPException(401)\n',
    ).replace(
      'guard(request: Request)',
      'guard(request: Request, prerequisite=Depends(logged))',
    );
    const r = measure(source, ['and', 'state.admin', 'state.loggedIn']);
    expect(r.checks[0].status).toBe('UNSAT');
    expect(r.checks[0].conditions.map((c) => c.name)).toEqual(['logged', 'guard']);
  });
  it.each([
    'if opaque(request):\n    return request\nraise HTTPException(403)',
    'request.state.admin = True\nreturn request',
    'await audit(request)\nreturn request',
    'for x in request.state.roles:\n    pass',
    'try:\n    raise HTTPException(403)\nexcept Exception:\n    pass',
    'yield request',
  ])('preserves UNKNOWN for unsupported behavior: %s', (body) => {
    const r = measure(sourceOf(body));
    expect(r.status).toBe('UNKNOWN');
    expect(r.modelSatisfiable).toBeNull();
  });
  it('refuses a rebound framework exception', () => {
    expect(
      measure(
        sourceOf(
          'raise HTTPException(403)',
          'Depends',
          'def HTTPException(code):\n    return None\n',
        ),
      ).status,
    ).toBe('UNKNOWN');
  });
  it('does not credit a locally rebound Security wrapper with a real guard', () => {
    const source = sourceOf(
      'raise HTTPException(403)',
      'Security',
      'def Security(target):\n    return None\n',
    );
    fixture(source, ({ base }) => {
      expect(base.report.skipped.some((s) => s.reason.includes('Security binding'))).toBe(
        true,
      );
      expect(
        canonicalizeGraph(base.graph).nodes.filter((n) => n.kind === 'guard'),
      ).toHaveLength(0);
    });
    expect(measure(source).status).toBe('UNKNOWN');
  });
  it('retains the dependency behind an unambiguous Security import alias', () => {
    const source = sourceOf('raise HTTPException(403)', 'Security')
      .replace(
        'Depends, Security, HTTPException',
        'Depends, Security as Access, HTTPException',
      )
      .replace('Security(guard)', 'Access(guard)');
    fixture(source, ({ base }) => {
      expect(
        canonicalizeGraph(base.graph).nodes.filter((n) => n.kind === 'guard'),
      ).toHaveLength(1);
    });
    expect(measure(source).checks[0].status).toBe('UNSAT');
  });
  it('refuses mounted routers and global middleware', () => {
    expect(
      measure(
        sourceOf('pass').replace('FastAPI()', 'FastAPI(dependencies=[Depends(guard)])'),
      ).status,
    ).toBe('UNKNOWN');
  });
  it('requires a current source binding', () => {
    fixture(sourceOf('pass'), ({ dir, policy }) => {
      fs.appendFileSync(path.join(dir, 'main.py'), '\n# changed\n');
      expect(
        compileUBG(dir, { write: false, sourceAuthorizationPolicy: policy }).report
          .sourceAuthorization.status,
      ).toBe('UNKNOWN');
    });
  });
  it('keeps sparse rules unknown and rejects out-of-language policy atoms', () => {
    fixture(sourceOf('pass'), ({ dir, policy }) => {
      policy.rules = Array(1);
      expect(
        compileUBG(dir, { write: false, sourceAuthorizationPolicy: policy }).report
          .sourceAuthorization.status,
      ).toBe('UNKNOWN');
    });
    expect(measure(sourceOf('pass'), 'session.admin').status).toBe('UNKNOWN');
  });
  it('declines a forged graph registration chain', () => {
    fixture(sourceOf('pass'), ({ dir, base, policy }) => {
      const graph = canonicalizeGraph(base.graph);
      const report = compileUBG(dir, { write: false, sourceAuthorizationPolicy: policy })
        .report.sourceAuthorization;
      for (const edge of graph.edges.filter(
        (e) => e.kind === 'control_flow' && e.meta?.route === 'entrypoint:POST /items',
      ))
        edge.meta.order += 90;
      const extracted = extractFastAPI(dir, 'main.py');
      expect(
        checkSourceAuthorization(dir, graph, extracted, policy, report.compilationFiles)
          .status,
      ).toBe('UNKNOWN');
    });
  });
  it('keeps missing runtime support unknown', () => {
    fixture(sourceOf('pass'), ({ dir, base, policy }) => {
      const compiled = compileUBG(dir, {
        write: false,
        sourceAuthorizationPolicy: policy,
      });
      const result = checkSourceAuthorization(
        dir,
        canonicalizeGraph(base.graph),
        extractFastAPI(dir, 'main.py'),
        policy,
        compiled.report.sourceAuthorization.compilationFiles,
        'sparda-no-such-python',
      );
      expect(result.status).toBe('UNKNOWN');
      expect(result.modelSatisfiable).toBeNull();
    });
  });
  it('declines dependency cycles and decorators', () => {
    expect(
      measure(
        sourceOf('pass').replace(
          'guard(request: Request)',
          'guard(request: Request, x=Depends(guard))',
        ),
      ).status,
    ).toBe('UNKNOWN');
    expect(
      measure(sourceOf('pass').replace('async def guard', '@opaque\nasync def guard'))
        .status,
    ).toBe('UNKNOWN');
  });
});

// Independent Tree-sitter syntax projection: does not import the CPython projector.
// Compare truth tables, not one implementation's pretty-printing of its formula.
function treeCondition(node, source) {
  const text = (n) => n.text;
  if (node.type === 'parenthesized_expression')
    return treeCondition(node.namedChildren[0], source);
  if (node.type === 'not_operator')
    return ['not', treeCondition(field(node, 'argument'), source)];
  if (node.type === 'boolean_operator') {
    const a = field(node, 'left'),
      b = field(node, 'right');
    const op = source.slice(a.endIndex, b.startIndex).trim();
    if (!['and', 'or'].includes(op)) throw Error('unknown boolean operator');
    return [op, treeCondition(a, source), treeCondition(b, source)];
  }
  const value = text(node);
  if (value === 'True' || value === 'False') return value === 'True';
  if (!/^request\.state\.(admin|loggedIn)$/.test(value))
    throw Error('unsupported independent predicate');
  return value.replace('request.', '');
}
const evalFormula = (f, a) =>
  typeof f === 'boolean'
    ? f
    : typeof f === 'string'
      ? a[f]
      : f[0] === 'not'
        ? !evalFormula(f[1], a)
        : f[0] === 'and'
          ? f.slice(1).every((x) => evalFormula(x, a))
          : f.slice(1).some((x) => evalFormula(x, a));
describe('independent Tree-sitter vs CPython authorization differential', () => {
  it('agrees over generated Boolean conditions and every two-atom assignment', async () => {
    await Parser.init();
    const language = await Language.load(
      require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    );
    const terms = [
      'request.state.admin',
      'request.state.loggedIn',
      'not request.state.admin',
      'not request.state.loggedIn',
      'True',
      'False',
    ];
    for (const left of terms)
      for (const right of terms)
        for (const op of ['and', 'or']) {
          const condition = `(${left}) ${op} (${right})`;
          const source = sourceOf(
            `if ${condition}:\n    return request\nraise HTTPException(403)`,
          );
          const parser = new Parser();
          parser.setLanguage(language);
          const syntax = parser.parse(source);
          const walk = function* (n) {
            yield n;
            for (const c of n.namedChildren ?? []) yield* walk(c);
          };
          const test = [...walk(syntax.rootNode)].find((n) => n.type === 'if_statement');
          const independent = treeCondition(field(test, 'condition'), source);
          syntax.delete();
          parser.delete();
          const result = spawnSync(
            'python',
            [path.resolve('src/ubg/python_admission.py')],
            {
              input: JSON.stringify({ source, entrypoint: 'entrypoint:POST /items' }),
              encoding: 'utf8',
            },
          );
          expect(result.status).toBe(0);
          const projection = JSON.parse(result.stdout);
          expect(projection.status).toBe('EXTRACTED');
          for (const admin of [false, true])
            for (const loggedIn of [false, true]) {
              const assignment = { 'state.admin': admin, 'state.loggedIn': loggedIn };
              expect(evalFormula(projection.conditions[0].formula, assignment)).toBe(
                evalFormula(independent, assignment),
              );
            }
        }
  }, 20000);
});
