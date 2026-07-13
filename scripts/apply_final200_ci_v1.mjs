import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const CONFIG_PATH = 'operations/patches/structured-expansion-batch-13c-config.json';
const BATCH_ID = 'structured-expansion-batch-13c';

const runNode = (script, env = {}) => {
  console.log(`\n> node ${script}`);
  execFileSync(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    timeout: 300_000,
  });
};

const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

runNode('scripts/generate_structured_expansion_batch_v2.mjs', {
  STRUCTURED_EXPANSION_CONFIG: CONFIG_PATH,
});

const patchListPath = path.join(ROOT, 'operations', 'patches', `${BATCH_ID}-patch-list.txt`);
const patchPaths = fs.readFileSync(patchListPath, 'utf8').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
if (patchPaths.length !== 10) throw new Error(`Expected 10 patches, got ${patchPaths.length}`);
for (const patchPath of patchPaths) {
  runNode('scripts/apply_company_data_patch_v1.mjs', { COMPANY_PATCH: patchPath });
}

runNode('scripts/apply_governance_ledger_batch_v1.mjs', {
  GOVERNANCE_LEDGER_BATCH: `operations/patches/${BATCH_ID}-ledger.json`,
});
runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/normalize_bundle_contract_v1.mjs');
runNode('scripts/validate_quality_v43.mjs');
runNode('scripts/validate_quality_score_v2.mjs');
runNode('scripts/validate_data_contract_v1.mjs');
runNode('scripts/validate_quality_dashboard_v1.mjs');

const manifest = readJson('site/data/bundle.manifest.json');
const dataDir = path.join(ROOT, 'site', 'data');
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(dataDir, part.file))));
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const count = stage => payload.companies.filter(company => company.stage === stage).length;
const structured = count('core') + count('detailed_extracted');
const sourceConfirmed = payload.companies.filter(company => company.stage !== 'jpx_indexed').length;
const reviewEvidenceCount = payload.companies.filter(company => Object.hasOwn(company, 'reviewEvidence')).length;

const assertions = {
  companyCount: payload.companies.length,
  structured,
  core: count('core'),
  detailedExtracted: count('detailed_extracted'),
  sourceIndexed: count('source_indexed'),
  jpxIndexed: count('jpx_indexed'),
  sourceConfirmed,
  compressedBytes: manifest.compressedBytes,
  absoluteBudgetBytes: 131072,
  reviewEvidenceCount,
};
console.log(JSON.stringify(assertions, null, 2));
if (assertions.companyCount !== 570) throw new Error(`companyCount=${assertions.companyCount}`);
if (assertions.structured !== 200) throw new Error(`structured=${assertions.structured}`);
if (assertions.core !== 30) throw new Error(`core=${assertions.core}`);
if (assertions.detailedExtracted !== 170) throw new Error(`detailedExtracted=${assertions.detailedExtracted}`);
if (assertions.sourceIndexed !== 0) throw new Error(`sourceIndexed=${assertions.sourceIndexed}`);
if (assertions.jpxIndexed !== 370) throw new Error(`jpxIndexed=${assertions.jpxIndexed}`);
if (assertions.sourceConfirmed !== 200) throw new Error(`sourceConfirmed=${assertions.sourceConfirmed}`);
if (assertions.compressedBytes > assertions.absoluteBudgetBytes) throw new Error(`bundle budget ${assertions.compressedBytes} > ${assertions.absoluteBudgetBytes}`);
if (assertions.reviewEvidenceCount !== 0) throw new Error(`reviewEvidenceCount=${assertions.reviewEvidenceCount}`);

const cleanPackage = {
  name: 'chu-kei',
  version: '43.0.0',
  private: true,
  description: '日本上場企業の中期経営計画を比較・理解・調査するための品質重視ポータル',
  type: 'module',
  scripts: {
    'quality:v43': 'node scripts/validate_quality_v43.mjs',
    'quality:local': 'node scripts/run_local_quality_gate.mjs',
    'quality:local:quick': 'node scripts/run_local_quality_gate.mjs --quick',
    quality: 'npm run quality:v43',
  },
  engines: { node: '>=20' },
};
fs.writeFileSync(path.join(ROOT, 'package.json'), `${JSON.stringify(cleanPackage, null, 2)}\n`);

const temporaryPaths = [
  'scripts/collect_final10_browser_links_v1.mjs',
  'scripts/collect_final10_root_fallback_v1.mjs',
  'scripts/diagnose_final10_browser_links_v1.mjs',
  'scripts/inspect_final3_dynamic_sources_v1.mjs',
  'scripts/research_final10_static_v1.mjs',
  'scripts/research_final10_static_v2.mjs',
  'scripts/research_final10_browser_pdfs_v1.mjs',
  'scripts/research_final3_selected_pdfs_v1.mjs',
  'scripts/research_final3_selected_pdfs_v2.mjs',
  'scripts/research_final3_selected_pdfs_v3.mjs',
  'scripts/apply_final200_ci_v1.mjs',
];
for (const relativePath of temporaryPaths) {
  const absolutePath = path.join(ROOT, relativePath);
  if (fs.existsSync(absolutePath)) fs.rmSync(absolutePath, { force: true });
}
if (fs.existsSync(path.join(ROOT, 'package-lock.json'))) fs.rmSync(path.join(ROOT, 'package-lock.json'), { force: true });

const statusOutput = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: ROOT });
const entries = statusOutput.toString('utf8').split('\0').filter(Boolean);
const files = [];
const deletions = [];
for (const entry of entries) {
  const status = entry.slice(0, 2);
  const relativePath = entry.slice(3);
  if (!relativePath || relativePath.startsWith('artifacts/') || relativePath.startsWith('node_modules/') || relativePath === 'package-lock.json') continue;
  if (status.includes('D')) {
    deletions.push(relativePath);
    continue;
  }
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) continue;
  files.push({
    path: relativePath,
    encoding: 'base64',
    content: fs.readFileSync(absolutePath).toString('base64'),
    bytes: fs.statSync(absolutePath).size,
  });
}
files.sort((a, b) => a.path.localeCompare(b.path));
deletions.sort();

const qualityReportPath = path.join(ROOT, 'artifacts', 'quality-report-v43.json');
const qualityReport = fs.existsSync(qualityReportPath) ? JSON.parse(fs.readFileSync(qualityReportPath, 'utf8')) : {};
qualityReport.final200Application = {
  version: 'final200-application-v1',
  generatedAt: new Date().toISOString(),
  assertions,
  patchCount: patchPaths.length,
  bundleSha256: manifest.sha256,
};
qualityReport.commitPackage = {
  version: 'github-tree-commit-package-v1',
  branch: 'data/structured-expansion-batch-13c',
  message: 'data: ソース確認済み200社を全件構造化',
  files,
  deletions,
  fileCount: files.length,
  deletionCount: deletions.length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
};
fs.mkdirSync(path.dirname(qualityReportPath), { recursive: true });
fs.writeFileSync(qualityReportPath, `${JSON.stringify(qualityReport, null, 2)}\n`);
console.log(JSON.stringify({
  final200Application: qualityReport.final200Application,
  commitPackage: {
    fileCount: files.length,
    deletionCount: deletions.length,
    totalBytes: qualityReport.commitPackage.totalBytes,
  },
}, null, 2));
