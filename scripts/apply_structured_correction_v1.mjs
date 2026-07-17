import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const MARKER_PATH = path.join(ROOT, 'operations', 'patches', 'run-structured-correction.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const runNode = (script, env = {}) => execFileSync(process.execPath, [script], {
  cwd: ROOT,
  env: { ...process.env, ...env },
  stdio: 'inherit',
});

if (!fs.existsSync(MARKER_PATH)) {
  console.log('No explicit structured correction marker found.');
  process.exit(0);
}

const marker = readJson(MARKER_PATH);
if (marker.schemaVersion !== 'structured-correction-run-v1') {
  throw new Error(`Unsupported structured correction marker: ${marker.schemaVersion}`);
}
if (!Array.isArray(marker.patchPaths) || marker.patchPaths.length === 0) {
  throw new Error('Structured correction requires non-empty patchPaths.');
}
if (!marker.ledgerPath) throw new Error('Structured correction requires ledgerPath.');

const resolveInsideRepo = relativePath => {
  const absolutePath = path.resolve(ROOT, String(relativePath || ''));
  const relative = path.relative(ROOT, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Correction path must be inside repository: ${relativePath}`);
  }
  if (!fs.existsSync(absolutePath)) throw new Error(`Correction file is missing: ${relativePath}`);
  return relative;
};

const patchPaths = marker.patchPaths.map(resolveInsideRepo);
const ledgerPath = resolveInsideRepo(marker.ledgerPath);

for (const patchPath of patchPaths) {
  runNode('scripts/apply_company_data_patch_v1.mjs', { COMPANY_PATCH: patchPath });
}
runNode('scripts/apply_governance_ledger_batch_v1.mjs', { GOVERNANCE_LEDGER_BATCH: ledgerPath });
runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/normalize_bundle_contract_v1.mjs');
runNode('scripts/build_frontend_data_shards_v1.mjs');

const capacityScript = path.join(ROOT, 'scripts', 'analyze_bundle_capacity_v1.mjs');
if (fs.existsSync(capacityScript)) runNode('scripts/analyze_bundle_capacity_v1.mjs');

fs.rmSync(MARKER_PATH);
console.log(`Structured correction marker consumed: ${path.relative(ROOT, MARKER_PATH)}`);
