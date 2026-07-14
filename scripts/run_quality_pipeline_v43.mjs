import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const sourceNormalizationMarker = path.join(ROOT, 'operations', 'source-coverage', 'normalize-source-indexed.json');
const companyCoverageMarkers = [
  path.join(ROOT, 'operations', 'coverage-growth', 'run-company-coverage.json'),
  path.join(ROOT, 'operations', 'coverage-growth', 'run-1000.json'),
];
const jpxOutput = path.join(ROOT, 'operations', 'research', 'jpx-listed-companies-latest.json');

const runNode = (script, env = {}) => execFileSync(process.execPath, [script], {
  cwd: ROOT,
  env: { ...process.env, ...env },
  stdio: 'inherit',
});
const runCommand = (command, args) => execFileSync(command, args, {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
});
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const firstExisting = paths => paths.find(file => fs.existsSync(file)) || null;
const isApplyWorkflow = process.env.GITHUB_WORKFLOW === 'Apply Structured Source of Truth';

const companyCoverageMarker = firstExisting(companyCoverageMarkers);
if (isApplyWorkflow && companyCoverageMarker) {
  const config = readJson(companyCoverageMarker);
  if (config.schemaVersion !== 'company-coverage-run-v1') {
    throw new Error(`Unsupported company coverage marker: ${config.schemaVersion}`);
  }
  console.log(`Expanding listed-company coverage to ${config.targetCompanyTotal} companies.`);
  runCommand('python3', ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'xlrd==2.0.1', 'openpyxl==3.1.5']);
  runCommand('python3', [
    'scripts/fetch_jpx_listed_companies_v1.py',
    '--output', path.relative(ROOT, jpxOutput),
    '--source-page', config.sourcePage,
  ]);
  runNode('scripts/apply_company_coverage_1000_v1.mjs', {
    TARGET_COMPANY_TOTAL: String(config.targetCompanyTotal),
    COVERAGE_VERIFIED_DATE: String(config.verifiedDate),
    COMPANY_COVERAGE_BUNDLE_BUDGET: String(config.bundleBudgetBytes || 262144),
  });
  fs.rmSync(companyCoverageMarker);
  console.log(`Company coverage marker consumed: ${path.relative(ROOT, companyCoverageMarker)}`);
}

if (isApplyWorkflow && fs.existsSync(sourceNormalizationMarker)) {
  runNode('scripts/normalize_source_indexed_coverage_v1.mjs');
  fs.rmSync(sourceNormalizationMarker);
  console.log('Source-indexed normalization marker consumed.');
}

runNode('scripts/apply_structured_expansion_ci_v1.mjs');
if (isApplyWorkflow) runNode('scripts/apply_core_evidence_repair_v1.mjs');
runNode('scripts/sync_production_approval_metadata_v1.mjs');
runNode('scripts/audit_production_readiness_v1.mjs');
if (isApplyWorkflow) {
  runNode('scripts/apply_production_promotion_v1.mjs');
  runNode('scripts/apply_core_approval_batch_v1.mjs');
}
runNode('scripts/sync_production_approval_metadata_v1.mjs');
runNode('scripts/audit_production_readiness_v1.mjs');
runNode('scripts/analyze_production_scale_candidates_v1.mjs');
