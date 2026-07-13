import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const marker = path.join(ROOT, 'operations', 'source-coverage', 'normalize-source-indexed.json');
const run = script => execFileSync(process.execPath, [script], { cwd: ROOT, env: process.env, stdio: 'inherit' });

if (process.env.GITHUB_WORKFLOW === 'Apply Structured Source of Truth' && fs.existsSync(marker)) {
  run('scripts/normalize_source_indexed_coverage_v1.mjs');
  fs.rmSync(marker);
  console.log('Source-indexed normalization marker consumed.');
}
run('scripts/apply_structured_expansion_ci_v1.mjs');
