import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const CONFIG_PATH = path.join(ROOT, 'operations', 'patches', 'structured-expansion-batch-14a-config.json');
const DATA_DIR = path.join(ROOT, 'site', 'data');

const runNode = (script, env = {}) => {
  console.log(`\n> node ${script}`);
  execFileSync(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const readBundle = () => {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))),
  );
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) {
    throw new Error(`Bundle SHA-256 mismatch: ${digest} !== ${manifest.sha256}`);
  }
  return JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
};

if (!fs.existsSync(CONFIG_PATH)) {
  console.log('No active structured expansion config. Running the normal v43 validator only.');
  runNode('scripts/validate_quality_v43.mjs');
  process.exit(0);
}

const config = readJson(CONFIG_PATH);
const fromStage = config.fromStage || 'jpx_indexed';
const targetStage = config.targetStage || 'detailed_extracted';
const targetCodes = new Set(config.records.map(record => String(record.code)));
const bundle = readBundle();
const targetCompanies = bundle.companies.filter(company => targetCodes.has(String(company.code)));

if (targetCompanies.length !== targetCodes.size) {
  const found = new Set(targetCompanies.map(company => String(company.code)));
  const missing = [...targetCodes].filter(code => !found.has(code));
  throw new Error(`Expansion target companies are missing from the bundle: ${missing.join(', ')}`);
}

const stages = new Set(targetCompanies.map(company => company.stage));
const allAtSource = stages.size === 1 && stages.has(fromStage);
const allAtTarget = stages.size === 1 && stages.has(targetStage);

if (allAtSource) {
  runNode('scripts/generate_structured_expansion_batch_v2.mjs', {
    STRUCTURED_EXPANSION_CONFIG: path.relative(ROOT, CONFIG_PATH),
  });

  const patchListPath = path.join(
    ROOT,
    'operations',
    'patches',
    `${config.batchId}-patch-list.txt`,
  );
  const patchPaths = fs.readFileSync(patchListPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const patchPath of patchPaths) {
    runNode('scripts/apply_company_data_patch_v1.mjs', { COMPANY_PATCH: patchPath });
  }
} else if (allAtTarget) {
  console.log(`All ${targetCompanies.length} expansion targets are already at ${targetStage}; patch application is skipped.`);
} else {
  const detail = targetCompanies.map(company => `${company.code}:${company.stage}`).join(', ');
  throw new Error(`Mixed or unexpected expansion stages detected: ${detail}`);
}

const ledgerPath = path.join(
  ROOT,
  'operations',
  'patches',
  `${config.batchId}-ledger.json`,
);
if (fs.existsSync(ledgerPath)) {
  runNode('scripts/apply_governance_ledger_batch_v1.mjs', {
    GOVERNANCE_LEDGER_BATCH: path.relative(ROOT, ledgerPath),
  });
}

runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/normalize_bundle_contract_v1.mjs');
runNode('scripts/build_frontend_data_shards_v1.mjs');

const capacityScript = path.join(ROOT, 'scripts', 'analyze_bundle_capacity_v1.mjs');
if (fs.existsSync(capacityScript)) {
  runNode('scripts/analyze_bundle_capacity_v1.mjs');
}

runNode('scripts/validate_quality_v43.mjs');
