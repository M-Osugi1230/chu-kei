import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const PATCH_DIR = path.join(ROOT, 'operations', 'patches');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const SOURCE_COVERAGE_MARKER = path.join(ROOT, 'operations', 'source-coverage', 'run-50-percent.json');
const SOURCE_DISCOVERY_REPORT = path.join(ROOT, 'operations', 'research', 'source-coverage-50-discovery.json');

const runNode = (script, env = {}, { allowFailure = false } = {}) => {
  console.log(`\n> node ${script}`);
  try {
    execFileSync(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    return true;
  } catch (error) {
    if (!allowFailure) throw error;
    console.warn(`${script} exited non-zero; preserving diagnostics for review.`);
    return false;
  }
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const shouldRunSourceCoverage = process.env.GITHUB_WORKFLOW === 'Apply Structured Source of Truth'
  && fs.existsSync(SOURCE_COVERAGE_MARKER);

if (shouldRunSourceCoverage) {
  const sourceRun = readJson(SOURCE_COVERAGE_MARKER);
  if (sourceRun.schemaVersion !== 'source-coverage-run-v1') {
    throw new Error(`Unsupported source coverage run schema: ${sourceRun.schemaVersion}`);
  }
  console.log(`Running source coverage expansion to ${sourceRun.targetSourceConfirmed} companies.`);
  runNode('scripts/generate_source_coverage_queue_v1.mjs', {
    TARGET_SOURCE_CONFIRMED: String(sourceRun.targetSourceConfirmed),
    SOURCE_DISCOVERY_POOL_MULTIPLIER: String(sourceRun.candidatePoolMultiplier || 1.75),
  });
  runNode('scripts/discover_source_coverage_v4.mjs', {
    SOURCE_DISCOVERY_CONCURRENCY: '6',
  }, { allowFailure: true });
  runNode('scripts/export_source_coverage_candidates_v1.mjs');

  const discovery = fs.existsSync(SOURCE_DISCOVERY_REPORT)
    ? readJson(SOURCE_DISCOVERY_REPORT)
    : null;
  if (discovery?.enoughForTarget) {
    runNode('scripts/apply_source_coverage_50_v1.mjs', {
      TARGET_SOURCE_CONFIRMED: String(sourceRun.targetSourceConfirmed),
      SOURCE_COVERAGE_BUNDLE_BUDGET: String(sourceRun.bundleBudgetBytes || 196608),
      SOURCE_VERIFIED_DATE: String(sourceRun.verifiedDate),
    });
    fs.rmSync(SOURCE_COVERAGE_MARKER);
    console.log('Source coverage marker consumed after successful application.');
  } else {
    console.warn(`Source coverage remains pending: verified=${discovery?.verifiedCount ?? 0}, needed=${discovery?.needed ?? sourceRun.targetSourceConfirmed}.`);
    console.warn('The canonical bundle is unchanged; discovery diagnostics will be committed for the next refinement.');
  }
}

const resolveConfigPath = () => {
  if (process.env.STRUCTURED_EXPANSION_CONFIG) {
    return path.resolve(process.env.STRUCTURED_EXPANSION_CONFIG);
  }
  if (!fs.existsSync(PATCH_DIR)) return null;

  const candidates = fs.readdirSync(PATCH_DIR)
    .filter(file => /^structured-expansion-batch-.*-config\.json$/.test(file))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));

  return candidates.length ? path.join(PATCH_DIR, candidates.at(-1)) : null;
};

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

const configPath = resolveConfigPath();
if (!configPath) {
  console.log('No structured expansion config found. Running the normal v43 validator only.');
  runNode('scripts/validate_quality_v43.mjs');
  process.exit(0);
}

const config = readJson(configPath);
console.log(`Active structured expansion config: ${path.relative(ROOT, configPath)}`);

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
    STRUCTURED_EXPANSION_CONFIG: path.relative(ROOT, configPath),
  });

  const patchListPath = path.join(PATCH_DIR, `${config.batchId}-patch-list.txt`);
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

const ledgerPath = path.join(PATCH_DIR, `${config.batchId}-ledger.json`);
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
