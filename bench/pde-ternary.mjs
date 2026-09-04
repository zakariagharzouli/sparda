import { performance } from 'node:perf_hooks';
import { PDE_STATUS, encodePdeStatusCache, solvePde, updatePde } from '../src/ubg/pde.js';

const parsedCount = Number(process.env.PDE_BENCH_CLAIMS ?? 50_000);
if (!Number.isSafeInteger(parsedCount) || parsedCount < 4)
  throw new Error('PDE_BENCH_CLAIMS must be an integer of at least 4');

function timed(run) {
  const started = performance.now();
  const value = run();
  return {
    milliseconds: Number((performance.now() - started).toFixed(3)),
    value,
  };
}

// A shallow, wide graph avoids using a benchmark to test JavaScript's call
// stack. Repairing one early column exercises the reverse-cone update against
// a full re-solve of the same graph.
function claimsFor(count) {
  const width = Math.ceil(Math.sqrt(count));
  const claims = [];
  for (let index = 0; index < count; index++) {
    const layer = Math.floor(index / width);
    const column = index % width;
    const id = `claim:${String(index).padStart(8, '0')}`;
    const requires = layer ? [`claim:${String(index - width).padStart(8, '0')}`] : [];
    claims.push({
      id,
      requires,
      certificate: {
        status: layer === 1 && column === 0 ? PDE_STATUS.UNKNOWN : PDE_STATUS.PROVEN,
        reason: layer === 1 && column === 0 ? 'benchmark repair seed' : 'benchmark root',
      },
    });
  }
  return { claims, repairId: `claim:${String(width).padStart(8, '0')}` };
}

const { claims, repairId } = claimsFor(parsedCount);
const initial = timed(() => solvePde(claims));
const differential = timed(() =>
  updatePde(initial.value, [
    {
      id: repairId,
      certificate: { status: PDE_STATUS.PROVEN, reason: 'benchmark repair' },
    },
  ]),
);
const fullAfterRepair = timed(() =>
  solvePde(
    claims.map((claim) =>
      claim.id === repairId
        ? {
            ...claim,
            certificate: {
              status: PDE_STATUS.PROVEN,
              reason: 'benchmark repair',
            },
          }
        : claim,
    ),
  ),
);

const cache = encodePdeStatusCache(differential.value);
console.log(
  JSON.stringify(
    {
      claims: parsedCount,
      initialSolveMs: initial.milliseconds,
      differentialRepairMs: differential.milliseconds,
      fullRepairMs: fullAfterRepair.milliseconds,
      differentialWork: differential.value.execution,
      fullRepairWork: fullAfterRepair.value.execution,
      ternaryStatusBytes: cache.bytes.length,
      equivalent:
        JSON.stringify([...differential.value.states]) ===
        JSON.stringify([...fullAfterRepair.value.states]),
    },
    null,
    2,
  ),
);
