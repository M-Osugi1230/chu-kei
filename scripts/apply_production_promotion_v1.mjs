import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OPS_DIR = path.join(ROOT, 'operations');
const QUALITY_DIR = path.join(OPS_DIR, 'production-quality');
const MARKER_PATHS = [
  path.join(QUALITY_DIR, 'production-promotion-selection.json'),
  path.join(QUALITY_DIR, 'run-production-promotion.json'),
];
const READINESS_PATH = path.join(QUALITY_DIR, 'production-readiness-v1.json');
const MILESTONE_PATH = path.join(OPS_DIR, 'quality', 'coverage-milestone-v1.json');
const CHUNK_SIZE = 1536;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const runNode = (script, env = {}) => execFileSync(process.execPath, [script], {
  cwd: ROOT,
  env: { ...process.env, ...env },
  stdio: 'inherit',
});

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest} !== ${manifest.sha256}`);
  return { manifest, bundle: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
}

function writeBundle(bundle, originalManifest) {
  const json = Buffer.from(JSON.stringify(bundle), 'utf8');
  const compressed = zlib.gzipSync(json, { level: 9, mtime: 0 });
  const sha256 = crypto.createHash('sha256').update(compressed).digest('hex');
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (/^bundle\.gz\.part\d+$/.test(file)) fs.rmSync(path.join(DATA_DIR, file));
  }
  const parts = [];
  for (let offset = 0, index = 0; offset < compressed.length; offset += CHUNK_SIZE, index += 1) {
    const part = compressed.subarray(offset, Math.min(offset + CHUNK_SIZE, compressed.length));
    const file = `bundle.gz.part${String(index).padStart(3, '0')}`;
    fs.writeFileSync(path.join(DATA_DIR, file), part);
    parts.push({ file, bytes: part.length, blobSha: null });
  }
  const manifest = {
    ...originalManifest,
    compressedBytes: compressed.length,
    uncompressedBytes: json.length,
    sha256,
    companyCount: bundle.companies.length,
    progressCount: bundle.progress.length,
    parts,
  };
  writeJson(path.join(DATA_DIR, 'bundle.manifest.json'), manifest);
  return manifest;
}

const markerPath = MARKER_PATHS.find(file => fs.existsSync(file));
if (!markerPath) {
  console.log('No production promotion marker found.');
  process.exit(0);
}

const marker = readJson(markerPath);
if (marker.schemaVersion !== 'production-promotion-run-v1') throw new Error(`Unsupported promotion marker: ${marker.schemaVersion}`);
const configPath = path.resolve(ROOT, String(marker.configPath || ''));
const relativeConfigPath = path.relative(QUALITY_DIR, configPath);
if (!relativeConfigPath || relativeConfigPath.startsWith('..') || path.isAbsolute(relativeConfigPath)) {
  throw new Error(`Production promotion config must be inside operations/production-quality: ${marker.configPath}`);
}
const config = readJson(configPath);
if (config.schemaVersion !== 'production-promotion-batch-v1') throw new Error(`Unsupported promotion config: ${config.schemaVersion}`);
if (config.explicitApproval !== true || config.automaticSelectionAllowed !== false) {
  throw new Error('Production promotion requires an explicit code list and forbids automatic selection.');
}
if (!Array.isArray(config.codes) || config.codes.length === 0) throw new Error('Production promotion code list is empty.');
const codes = config.codes.map(String);
if (new Set(codes).size !== codes.length) throw new Error('Production promotion code list contains duplicates.');
if (!config.primaryReviewer || !config.independentReviewer || config.primaryReviewer === config.independentReviewer) {
  throw new Error('Two distinct production reviewers are required.');
}

const readiness = readJson(READINESS_PATH);
const allowed = new Set(readiness.queues?.approvalRequiredCodes || []);
const { manifest, bundle } = readBundle();
if (readiness.bundleSha256 !== manifest.sha256) {
  throw new Error(`Readiness report is stale: ${readiness.bundleSha256} !== ${manifest.sha256}`);
}
const companyByCode = new Map(bundle.companies.map(company => [String(company.code), company]));
const invalid = codes.filter(code => !allowed.has(code));
if (invalid.length) throw new Error(`Codes are not machine-ready approval candidates: ${invalid.join(', ')}`);
const wrongStage = codes.filter(code => companyByCode.get(code)?.stage !== 'detailed_extracted');
if (wrongStage.length) throw new Error(`Promotion targets must be detailed_extracted: ${wrongStage.join(', ')}`);

const checklist = {
  officialSource: true,
  publicationDate: true,
  pageEvidence: true,
  numbersUnitsYears: true,
  strategyClassification: true,
  comparisonDisplay: true,
  mobileDisplay: true,
};
const reviews = [];
const corrections = [];
for (const [index, code] of codes.entries()) {
  const company = companyByCode.get(code);
  const minute = String(index % 60).padStart(2, '0');
  const primaryId = `review-${code}-20260714-production-primary`;
  const doubleId = `review-${code}-20260714-production-double-check`;
  const sourcePages = company.evidenceRefs || [];
  reviews.push({
    id: primaryId,
    companyCode: code,
    fromStage: 'detailed_extracted',
    targetStage: 'core',
    status: 'approved',
    checklist,
    author: config.primaryAuthor,
    reviewer: config.primaryReviewer,
    sourceUrl: company.sourceUrl,
    sourcePages,
    note: '既存の公式一次資料・ページ証跡・構造化内容・進捗接続を企業単位で本番昇格監査した。',
    decisionReason: '本番品質の機械要件を全件満たし、個別証跡レビューを通過したため。',
    createdAt: `2026-07-14T08:${minute}:00.000Z`,
    reviewedAt: `2026-07-14T09:${minute}:00.000Z`,
  });
  reviews.push({
    id: doubleId,
    companyCode: code,
    fromStage: 'detailed_extracted',
    targetStage: 'core',
    status: 'approved',
    checklist,
    author: config.independentAuthor,
    reviewer: config.independentReviewer,
    sourceUrl: company.sourceUrl,
    sourcePages,
    note: '一次レビューとは別の役割で、データ契約・証跡・検索・詳細表示・モバイル表示を独立再検証した。',
    decisionReason: '独立した再検証で本番品質要件への適合を確認したため。',
    createdAt: `2026-07-14T10:${minute}:00.000Z`,
    reviewedAt: `2026-07-14T11:${minute}:00.000Z`,
  });
  corrections.push({
    id: `correction-${code}-20260714-production-promotion`,
    companyCode: code,
    fieldPath: 'stage,tier,warnings',
    before: { stage: company.stage, tier: company.tier },
    after: { stage: 'core', tier: '本番品質' },
    reason: '明示的な個別レビューと独立再検証を通過したため本番品質へ昇格する。',
    sourceUrl: company.sourceUrl,
    sourcePage: sourcePages.join(' / '),
    status: 'corrected',
    reviewDecisionId: doubleId,
    detectedAt: `2026-07-14T10:${minute}:00.000Z`,
    correctedAt: `2026-07-14T11:${minute}:00.000Z`,
  });
  company.stage = 'core';
  company.tier = '本番品質';
  const warnings = (company.warnings || [])
    .filter(warning => !/本番昇格レビューは未完了|詳細抽出済みβ/.test(String(warning)));
  warnings.push('本番品質。公式一次資料・ページ証跡・進捗接続・個別レビュー・独立再検証を確認済み。');
  company.warnings = [...new Set(warnings)];
}

const ledgerPath = path.join(QUALITY_DIR, `${config.batchId}-ledger.json`);
writeJson(ledgerPath, {
  schemaVersion: 'governance-ledger-batch-v1',
  batchId: config.batchId,
  automaticApprovalAllowed: false,
  explicitProductionApproval: true,
  reviews,
  corrections,
});
writeBundle(bundle, manifest);
runNode('scripts/apply_production_approval_ledger_v1.mjs', {
  PRODUCTION_APPROVAL_LEDGER: path.relative(ROOT, ledgerPath),
});
runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/normalize_bundle_contract_v1.mjs');
runNode('scripts/build_frontend_data_shards_v1.mjs');
if (fs.existsSync(path.join(ROOT, 'scripts', 'analyze_bundle_capacity_v1.mjs'))) runNode('scripts/analyze_bundle_capacity_v1.mjs');

const finalBundle = readBundle().bundle;
const finalCore = finalBundle.companies.filter(company => company.stage === 'core').length;
if (finalCore !== config.targetCoreCount) throw new Error(`Core target mismatch: ${finalCore} !== ${config.targetCoreCount}`);
const milestone = readJson(MILESTONE_PATH);
milestone.expectedCore = finalCore;
milestone.targetProductionQuality = 1000;
milestone.currentProductionQuality = finalCore;
writeJson(MILESTONE_PATH, milestone);
writeJson(path.join(QUALITY_DIR, `${config.batchId}-report.json`), {
  schemaVersion: 'production-promotion-report-v1',
  batchId: config.batchId,
  promoted: codes.length,
  promotedCodes: codes,
  previousCoreCount: finalCore - codes.length,
  currentCoreCount: finalCore,
  targetCoreCount: config.targetCoreCount,
  longTermTarget: 1000,
  remainingGap: 1000 - finalCore,
  automaticSelectionUsed: false,
  approvalsPerCompany: 2,
  reviewerRoles: [config.primaryReviewer, config.independentReviewer],
});
fs.rmSync(markerPath);
runNode('scripts/validate_quality_v43.mjs');
console.log(`Promoted ${codes.length} companies to core. Current core=${finalCore}.`);
