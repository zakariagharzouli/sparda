// ubg/semantic-facts.js — language-neutral, conservative semantic fact protocol.
//
// A parser/frontend reports every relevant surface as a parsed fact. The fast
// layer may only label such a fact a CANDIDATE; only an exact semantic linker may
// discharge it as MODELLED. Everything else remains UNMEASURED. This is Fabric
// F1/F2 made executable: a language pack cannot silently shrink its own subject.

export const SEMANTIC_PHASE = Object.freeze({
  FAST: 'fast',
  EXACT: 'exact',
});

export const SEMANTIC_STATE = Object.freeze({
  CANDIDATE: 'candidate',
  MODELLED: 'modelled',
  UNMEASURED: 'unmeasured',
});

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort(cmp)
        .map((key) => JSON.stringify(key) + ':' + stable(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

function normalizeFact(raw) {
  if (!raw?.id) throw new Error('semantic facts require a stable id');
  if (!raw?.kind) throw new Error('semantic fact ' + raw.id + ' requires a kind');
  if (!raw?.source?.file)
    throw new Error('semantic fact ' + raw.id + ' requires a source file');
  return {
    id: raw.id,
    kind: raw.kind,
    language: raw.language ?? 'unknown',
    source: {
      file: raw.source.file,
      line: raw.source.line ?? 0,
    },
  };
}

function normalizedFacts(rawFacts) {
  const byId = new Map();
  for (const raw of rawFacts ?? []) {
    const fact = normalizeFact(raw);
    if (byId.has(fact.id)) throw new Error('duplicate semantic fact ' + fact.id);
    byId.set(fact.id, fact);
  }
  return [...byId.values()].sort((a, b) => cmp(a.id, b.id));
}

// Layer 1: fast, deterministic and deliberately weak. It discovers a surface
// cheaply, but a candidate is never a semantic conclusion and never a proof.
export function fastSemanticCandidates(rawFacts) {
  return normalizedFacts(rawFacts).map((fact) => ({
    ...fact,
    phase: SEMANTIC_PHASE.FAST,
    state: SEMANTIC_STATE.CANDIDATE,
  }));
}

// Layer 2: only exact facts may discharge parsed surface. justifiedIrrelevant
// is rejected until Fabric owns an independently checkable justification
// contract. An empty third category is strictly conservative.
export function reconcileSemanticFacts({
  parsedFacts,
  exactFactIds = [],
  justifiedIrrelevant = [],
}) {
  if (justifiedIrrelevant.length)
    throw new Error(
      'justifiedIrrelevant is unavailable until its justification is independently checkable',
    );

  const parsed = normalizedFacts(parsedFacts);
  const known = new Set(parsed.map((fact) => fact.id));
  const exact = [...new Set(exactFactIds)].sort(cmp);
  for (const id of exact)
    if (!known.has(id))
      throw new Error('exact semantic claim ' + id + ' has no parsed fact to conserve');

  const modelled = parsed
    .filter((fact) => exact.includes(fact.id))
    .map((fact) => ({
      ...fact,
      phase: SEMANTIC_PHASE.EXACT,
      state: SEMANTIC_STATE.MODELLED,
    }));
  const unmeasured = parsed
    .filter((fact) => !exact.includes(fact.id))
    .map((fact) => ({
      ...fact,
      phase: SEMANTIC_PHASE.EXACT,
      state: SEMANTIC_STATE.UNMEASURED,
      reason: 'parsed surface has no exact semantic claim',
    }));

  return {
    v: 'sparda-semantic-facts/v1',
    parsed,
    modelled,
    justifiedIrrelevant: [],
    unmeasured,
    conservation: {
      parsed: parsed.length,
      modelled: modelled.length,
      unmeasured: unmeasured.length,
      fingerprint: stable({
        parsed: parsed.map((fact) => fact.id),
        modelled: modelled.map((fact) => fact.id),
        unmeasured: unmeasured.map((fact) => fact.id),
      }),
    },
  };
}

// Fabric F2's structural coverage boundary.  Frontends supply the syntax they
// actually consumed and the exact UBG facts that survived lowering.  The third
// bucket is deliberately not an option: until Fabric 2/2 can independently
// verify a justification, it stays provably empty.
export function structuralCoverage({
  parsedFacts,
  claimedFactIds = [],
  justifiedIrrelevant = [],
}) {
  const ledger = reconcileSemanticFacts({
    parsedFacts,
    exactFactIds: claimedFactIds,
    justifiedIrrelevant,
  });
  return {
    ...ledger,
    coverage: {
      parsed: ledger.parsed.length,
      claimed: ledger.modelled.length,
      justifiedIrrelevant: ledger.justifiedIrrelevant.length,
      unmeasured: ledger.unmeasured.length,
      complete: ledger.unmeasured.length === 0,
    },
  };
}

export function semanticStatus(ledger) {
  return ledger.unmeasured.length ? 'unknown' : 'proven';
}
