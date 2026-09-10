import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureProject } from './compare.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2];
if (!output) throw Error('Pass an explicit output JSON path');
const projects = [
  ['fastapi-basic', 'tests/fixtures/fastapi-basic', 'main.py'],
  ['fastapi-package', 'tests/fixtures/fastapi-package', 'app/main.py'],
  ['ubg-fastapi', 'tests/fixtures/ubg-fastapi', 'main.py'],
  ['ubg-fastapi-deep', 'tests/fixtures/ubg-fastapi-deep', 'main.py'],
  ['ubg-fastapi-ghost', 'tests/fixtures/ubg-fastapi-ghost', 'main.py'],
  ['explicit-contract', 'internal/fastapi-differential/fixtures/contract', 'main.py'],
];
const rows = [];
for (const [name, relative, entry] of projects) {
  const result = await measureProject(
    path.join(repo, relative),
    entry,
    process.env.SPARDA_PYTHON ?? 'python',
  );
  rows.push({ name, ...result });
  console.log(
    JSON.stringify({
      name,
      ...result.comparison,
      unknowns: result.semantic.unknowns.map((u) => u.reason),
    }),
  );
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(
  output,
  JSON.stringify(
    { schema: 'fastapi-differential-campaign/v1', productionEligible: false, rows },
    null,
    2,
  ),
);
if (rows.some((r) => r.comparison.zeroLoss !== true)) process.exitCode = 1;
