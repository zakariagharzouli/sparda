// One identity for an analysed body, computed by ONE function.
//
// Before this, two formats existed and neither knew about the other: the resolver
// blamed a body with a local `<file>#<line>` concatenation, and the compiler keyed
// its nodes `logic:<file>#<symbol>:<line>`. They could never be equal, so 21,800
// declared resolution stops joined exactly zero graph nodes — the ledger was honest
// and useless at the same time. One immich owner was even an ABSOLUTE path, which
// would not have compared equal on another machine either (E-109).
//
// `bodyKey` is now the only producer of that identity, and the node ids are derived
// from it, so "the resolver and the compiler agree" is true by construction rather
// than by two call sites formatting a string the same way.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bodyKey,
  bodyKeyOfNodeId,
  canonicalizeGraph,
  guardId,
  logicId,
  normalizeRelPath,
} from '../src/ubg/schema.js';
import { compileUBG } from '../src/ubg/compile.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('a path is a portable identity component', () => {
  it('normalises Windows separators to POSIX', () => {
    // the same checkout analysed on Windows must produce the same id
    expect(normalizeRelPath('src\\routes\\users.js')).toBe('src/routes/users.js');
    expect(bodyKey('src\\a\\b.js', 'handler', 7)).toBe(
      bodyKey('src/a/b.js', 'handler', 7),
    );
  });

  it('strips a leading ./ so two spellings of one path are one identity', () => {
    expect(normalizeRelPath('./src/app.js')).toBe('src/app.js');
    expect(bodyKey('./src/app.js', 'h', 1)).toBe(bodyKey('src/app.js', 'h', 1));
  });

  it('is total — a missing path degrades to a stable string, never a crash', () => {
    expect(normalizeRelPath(null)).toBe('');
    expect(normalizeRelPath(undefined)).toBe('');
  });
});

describe('node ids are the body key plus a kind', () => {
  it('logic and guard ids differ only by prefix', () => {
    expect(logicId('src/a.js', 'h', 3)).toBe(`logic:${bodyKey('src/a.js', 'h', 3)}`);
    expect(guardId('src/a.js', 'h', 3)).toBe(`guard:${bodyKey('src/a.js', 'h', 3)}`);
  });

  it('the prefix strips back to exactly the body key', () => {
    // This is the join. If it ever stops being an identity, a boundary and the node
    // it belongs to become two unrelated strings again — silently, because both
    // sides still look well-formed.
    for (const [file, name, line] of [
      ['src/a.js', 'h', 3],
      ['src/x/y.ts', 'UserService.update', 120],
      ['src/anon.js', 'anonymous', 1],
    ]) {
      expect(bodyKeyOfNodeId(logicId(file, name, line))).toBe(bodyKey(file, name, line));
      expect(bodyKeyOfNodeId(guardId(file, name, line))).toBe(bodyKey(file, name, line));
    }
  });

  it('a body key survives a symbol containing dots', () => {
    // `Class.method` is the commonest interprocedural owner name, and it contains
    // the separator a naive split would use
    const id = logicId('src/s.ts', 'AuthService.validate', 44);
    expect(bodyKeyOfNodeId(id)).toBe('src/s.ts#AuthService.validate:44');
  });
});

describe('the resolver and the compiler agree, end to end', () => {
  const { graph, report } = compileUBG(
    path.join(here, 'fixtures', 'workspace-boundary', 'apps', 'api'),
    { write: false },
  );
  const g = canonicalizeGraph(graph);
  const bodies = new Map(
    g.nodes
      .filter((n) => n.kind === 'logic' || n.kind === 'guard')
      .map((n) => [bodyKeyOfNodeId(n.id), n.id]),
  );
  const boundaries = (report.kernel?.facts ?? []).filter(
    (f) => f.kind === 'UnknownBoundary',
  );

  it('every declared stop joins a real node in the graph', () => {
    expect(boundaries.length).toBeGreaterThan(0);
    const orphans = boundaries.filter((f) => !f.owner || !bodies.has(f.owner));
    expect(orphans.map((f) => `${f.provenance.uncertainty}:${f.symbol}`)).toEqual([]);
  });

  it('no owner is ever an absolute path', () => {
    // an absolute path embeds the checkout directory: same source, different id on
    // another machine, and the join silently stops working
    for (const f of boundaries) {
      expect(f.owner.startsWith('/')).toBe(false);
      expect(f.owner).not.toMatch(/^[A-Za-z]:[\\/]/);
    }
  });

  it('an anonymous handler still has a stable identity', () => {
    // Express handlers are usually anonymous arrows. Their identity comes from the
    // REGISTRATION, not from the body — the resolver cannot derive it, so the
    // lowering hands it over.
    const anon = boundaries.filter((f) => f.owner.includes('#anonymous:'));
    expect(anon.length).toBeGreaterThan(0);
    for (const f of anon) expect(bodies.has(f.owner)).toBe(true);
  });
});

describe('the DI path joins too — it is where the walk is deepest', () => {
  // The Express fixture above cannot exercise `handlerScan` / `classMethodBundle`,
  // and those are exactly the two call sites that passed no owner at all. A test
  // that only covers Express would let that regression back in unseen.
  const nest = compileUBG(path.join(here, 'fixtures', 'nest-di-blindspot-location'), {
    write: false,
  });
  const ng = canonicalizeGraph(nest.graph);
  const nestBodies = new Set(
    ng.nodes
      .filter((n) => n.kind === 'logic' || n.kind === 'guard')
      .map((n) => bodyKeyOfNodeId(n.id)),
  );
  const nestBoundaries = (nest.report.kernel?.facts ?? []).filter(
    (f) => f.kind === 'UnknownBoundary',
  );

  it('a controller-rooted stop carries the handler body as its owner', () => {
    expect(nestBoundaries.length).toBeGreaterThan(0);
    const joined = nestBoundaries.filter((f) => f.owner && nestBodies.has(f.owner));
    expect(joined.length).toBeGreaterThan(0);
  });

  it('a stop never has a silently absent owner', () => {
    // hard rule 9 at the attachment layer: an owner is either a well-formed body
    // key or an explicit `missing-owner-provenance` declaration. `null` with no
    // declaration is the state that reads downstream exactly like a body that
    // never stopped, and it is the one this forbids.
    for (const f of nestBoundaries) {
      // the two EXPLICIT declarations of absence — each says something different,
      // and both are the opposite of silence
      if (f.provenance.uncertainty === 'missing-owner-provenance') continue;
      if (f.provenance.uncertainty === 'owner-not-in-ubg') continue;
      expect(typeof f.owner).toBe('string');
      expect(f.owner).toMatch(/^[^/].*#.+:\d+$/);
    }
  });

  it('names, but does not hide, the bodies the compiler never registered', () => {
    // `ExportService.writeReport` is walked by the resolver and is NOT turned into
    // a node by the compiler, so its owner key is well-formed and joins nothing.
    // That is a REAL remaining gap — the resolver walks strictly more bodies than
    // the graph carries — and pinning it here stops it from being discovered twice.
    // It must never be silent, and it must never be mistaken for a joined stop.
    // `owner-not-in-ubg` IS that declaration: one fact per orphan owner, carrying
    // the owner it could not place. Counting it proves the population is measured
    // rather than absorbed into the joined one.
    const declaredOrphans = nestBoundaries
      .filter((f) => f.provenance.uncertainty === 'owner-not-in-ubg')
      .map((f) => f.symbol);
    expect(declaredOrphans).toEqual([
      'src/services/export.service.ts#ExportService.writeReport:9',
    ]);
  });
});

describe('an owner-less walk is declared, not dropped', () => {
  it('`missing-owner-provenance` is a closed, named reason', async () => {
    const { UNCERTAINTY_REASONS } = await import('../src/ubg/kernel/facts.js');
    // A stop the walk really made, inside a body the compiler never registered.
    // Dropping it because its address is missing is the loss shape hard rule 9
    // forbids, one level in: downstream it reads exactly like a body that never
    // stopped at all.
    expect(UNCERTAINTY_REASONS).toContain('missing-owner-provenance');
  });
});
