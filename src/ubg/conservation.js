// ubg/conservation.js — Fabric F1: every compiler boundary accounts for its facts.
//
// A pass is allowed to add facts, merge identities, or deliberately discard an
// unreachable fact.  It is never allowed to make one disappear without saying
// which of those happened and, for a loss, why.  This is translation validation
// for the UBG pipeline: the certificate is data that downstream tooling and
// tests can check, not a convention hidden in a comment.
import { cmp, stableStringify } from './schema.js';

const sorted = (values) => [...values].sort(cmp);

function uniqueIds(values, label) {
  const ids = values.map((value) => (typeof value === 'string' ? value : value.id));
  if (ids.some((id) => typeof id !== 'string' || id.length === 0))
    throw new Error(`Fabric conservation: ${label} contains an invalid fact id`);
  if (new Set(ids).size !== ids.length)
    throw new Error(`Fabric conservation: ${label} contains a duplicate fact id`);
  return sorted(ids);
}

function records(values, label) {
  const normalized = values.map((value) =>
    typeof value === 'string' ? { id: value } : { ...value },
  );
  uniqueIds(normalized, label);
  return normalized.sort((a, b) => cmp(a.id, b.id));
}

function edgeId(edge) {
  return `edge:${edge.kind}:${edge.from}->${edge.to}:${stableStringify(edge.meta ?? {})}`;
}

// A graph inventory uses immutable identities only. Metadata annotations may be
// enriched by a pass, but enrichment is not a disappearance of the behavior the
// node/edge already represented.
export function graphFactInventory(graph) {
  const nodes = [...graph.nodes.values()]
    .map((node) => ({ id: `node:${node.id}`, kind: 'node', nodeIds: [node.id] }))
    .sort((a, b) => cmp(a.id, b.id));
  const duplicateOrdinal = new Map();
  const edges = [...graph.edges]
    .map((edge) => ({ key: edgeId(edge), edge }))
    .sort((a, b) => cmp(a.key, b.key))
    .map(({ key, edge }) => {
      const ordinal = duplicateOrdinal.get(key) ?? 0;
      duplicateOrdinal.set(key, ordinal + 1);
      return {
        id: `${key}#${ordinal}`,
        kind: 'edge',
        nodeIds: [edge.from, edge.to],
      };
    });
  return [...nodes, ...edges];
}

// The equation is deliberately explicit:
//
//   before + introduced = after + merged + lost
//
// `merged` counts a consumed input identity; `lost` counts an input identity
// with a named reason.  Set equality, rather than only counts, catches the
// dangerous case where one fact vanishes while another coincidentally appears.
export function certifyConservation({
  pass,
  factsBefore,
  factsAfter,
  nodesIntroduced = [],
  nodesMerged = [],
  informationLost = [],
  invariantsPreserved = [],
}) {
  if (!pass) throw new Error('Fabric conservation: a pass name is required');
  const before = uniqueIds(factsBefore, `${pass}.factsBefore`);
  const after = uniqueIds(factsAfter, `${pass}.factsAfter`);
  const introduced = records(nodesIntroduced, `${pass}.nodesIntroduced`);
  const merged = records(nodesMerged, `${pass}.nodesMerged`);
  const lost = records(informationLost, `${pass}.informationLost`);

  for (const record of lost) {
    if (!record.reason)
      throw new Error(`Fabric conservation: ${pass} lost ${record.id} without a reason`);
  }

  const left = uniqueIds([...before, ...introduced], `${pass}.left`);
  const right = uniqueIds([...after, ...merged, ...lost], `${pass}.right`);
  const missingOnRight = left.filter((id) => !right.includes(id));
  const inventedOnRight = right.filter((id) => !left.includes(id));
  if (missingOnRight.length || inventedOnRight.length) {
    const details = [
      missingOnRight.length ? `unaccounted: ${missingOnRight.join(', ')}` : null,
      inventedOnRight.length ? `unexplained: ${inventedOnRight.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(`Fabric conservation violation in ${pass}: ${details}`);
  }

  return {
    v: 'sparda-conservation/v1',
    pass,
    factsBefore: before,
    factsAfter: after,
    invariantsPreserved: sorted([
      'all-facts-accounted',
      'every-loss-has-a-reason',
      'deterministic-fact-order',
      ...invariantsPreserved,
    ]),
    nodesIntroduced: introduced,
    nodesMerged: merged,
    informationLost: lost,
    lossReasons: Object.fromEntries(lost.map((record) => [record.id, record.reason])),
    balance: {
      before: before.length,
      introduced: introduced.length,
      after: after.length,
      merged: merged.length,
      lost: lost.length,
      balanced: true,
    },
  };
}

function recordsForPass(before, after, result) {
  const mergedNodes = new Map(
    (result.details ?? [])
      .filter((detail) => detail.absorbed && detail.into)
      .map((detail) => [detail.absorbed, detail.into]),
  );
  const lostNodes = new Map(
    (result.details ?? [])
      .filter((detail) => detail.id && detail.reason)
      .map((detail) => [detail.id, detail.reason]),
  );
  const beforeById = new Map(before.map((fact) => [fact.id, fact]));
  const afterIds = new Set(after.map((fact) => fact.id));
  const introduced = after.filter((fact) => !beforeById.has(fact.id));
  const merged = [];
  const lost = [];

  for (const fact of before) {
    if (afterIds.has(fact.id)) continue;
    const related = fact.nodeIds ?? [];
    const mergedInto = related.map((id) => mergedNodes.get(id)).find(Boolean);
    const loss = related.map((id) => lostNodes.get(id)).find(Boolean);
    if (mergedInto) {
      merged.push({
        id: fact.id,
        into: `node:${mergedInto}`,
        reason: 'identity absorbed by declared graph merge',
      });
      continue;
    }
    if (loss) {
      lost.push({
        id: fact.id,
        reason: `declared pass loss: ${loss}`,
      });
      continue;
    }
    // This is the load-bearing F1 failure: a pass deleted a graph fact but did
    // not classify it as a merge or a named loss.  Do not let a later verdict
    // consume an unbalanced graph.
    throw new Error(
      `Fabric conservation violation in ${result.name ?? 'pipeline pass'}: ${fact.id} disappeared without classification`,
    );
  }

  return { introduced, merged, lost };
}

export function certifyGraphPass(pass, beforeGraph, afterGraph, result = {}) {
  const before = graphFactInventory(beforeGraph);
  const after = graphFactInventory(afterGraph);
  const { introduced, merged, lost } = recordsForPass(before, after, {
    ...result,
    name: pass,
  });
  return certifyConservation({
    pass,
    factsBefore: before,
    factsAfter: after,
    nodesIntroduced: introduced,
    nodesMerged: merged,
    informationLost: lost,
    invariantsPreserved: ['graph-valid-after-pass'],
  });
}
