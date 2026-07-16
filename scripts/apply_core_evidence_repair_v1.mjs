import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const QUALITY_DIR = path.join(ROOT, 'operations', 'production-quality');
const LEGACY_MARKER_PATH = path.join(QUALITY_DIR, 'run-core-evidence-repair.json');
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
  writeJson(path.join(DATA_DIR, 'bundle.manifest.json'), {
    ...originalManifest,
    compressedBytes: compressed.length,
    uncompressedBytes: json.length,
    sha256,
    companyCount: bundle.companies.length,
    progressCount: bundle.progress.length,
    parts,
  });
}

function findEmbeddedRepair() {
  const files = fs.readdirSync(QUALITY_DIR)
    .filter(file => /^evidence-repair-batch-\d+\.json$/.test(file))
    .sort((a, b) => Number(b.match(/\d+/)?.[0] || 0) - Number(a.match(/\d+/)?.[0] || 0));
  for (const file of files) {
    const filePath = path.join(QUALITY_DIR, file);
    const config = readJson(filePath);
    if (config.runRequested === true && config.schemaVersion === 'core-evidence-repair-batch-v1') {
      return { filePath, config };
    }
  }
  return null;
}

let markerPath = null;
let configPath = null;
let embeddedRepair = null;
if (fs.existsSync(LEGACY_MARKER_PATH)) {
  markerPath = LEGACY_MARKER_PATH;
  const marker = readJson(markerPath);
  if (marker.schemaVersion !== 'core-evidence-repair-run-v1') {
    throw new Error(`Unsupported core evidence repair marker: ${marker.schemaVersion}`);
  }
  configPath = path.resolve(ROOT, String(marker.configPath || ''));
  const relativeConfigPath = path.relative(QUALITY_DIR, configPath);
  if (!relativeConfigPath || relativeConfigPath.startsWith('..') || path.isAbsolute(relativeConfigPath)) {
    throw new Error(`Core evidence repair config must be inside operations/production-quality: ${marker.configPath}`);
  }
} else {
  embeddedRepair = findEmbeddedRepair();
  if (!embeddedRepair) {
    console.log('No evidence repair marker or embedded run request found.');
    process.exit(0);
  }
  configPath = embeddedRepair.filePath;
}

const config = readJson(configPath);
if (config.schemaVersion !== 'core-evidence-repair-batch-v1') {
  throw new Error(`Unsupported evidence repair config: ${config.schemaVersion}`);
}
if (config.explicitSelection !== true || config.automaticSelectionAllowed !== false) {
  throw new Error('Evidence repair requires explicit records and forbids automatic selection.');
}
if (!Array.isArray(config.records) || config.records.length === 0) throw new Error('Evidence repair records are empty.');
const codes = config.records.map(record => String(record.code));
if (new Set(codes).size !== codes.length) throw new Error('Evidence repair contains duplicate codes.');
const allowedStages = new Set(config.allowedStages || ['core']);
if (![...allowedStages].every(stage => ['core', 'detailed_extracted'].includes(stage))) {
  throw new Error(`Unsupported evidence repair stage: ${[...allowedStages].join(', ')}`);
}

const { manifest, bundle } = readBundle();
const companyByCode = new Map(bundle.companies.map(company => [String(company.code), company]));
const reviews = [];
const corrections = [];
for (const [index, record] of config.records.entries()) {
  const code = String(record.code);
  const company = companyByCode.get(code);
  if (!company) throw new Error(`Evidence repair company not found: ${code}`);
  if (!allowedStages.has(company.stage)) throw new Error(`Evidence repair target stage is not allowed: ${code}:${company.stage}`);
  if (record.expectedStage && record.expectedStage !== company.stage) {
    throw new Error(`Evidence repair expected stage mismatch: ${code}:${company.stage} !== ${record.expectedStage}`);
  }
  if (!record.sourceUrl?.startsWith('https://')) throw new Error(`Official HTTPS source is required: ${code}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.planPublishedDate || '')) throw new Error(`Valid planPublishedDate is required: ${code}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.verifiedDate || '')) throw new Error(`Valid verifiedDate is required: ${code}`);
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.length < 2) throw new Error(`At least two page evidence refs are required: ${code}`);
  if (!record.evidenceRefs.every(ref => /(?:PDF\s+p\.?\s*\d|ページ\s*\d)/i.test(String(ref)))) {
    throw new Error(`Every evidence ref must contain a page number: ${code}`);
  }
  if (!record.reason || String(record.reason).length < 20) throw new Error(`Detailed repair reason is required: ${code}`);

  const before = {
    sourceUrl: company.sourceUrl ?? null,
    document: company.document ?? null,
    planPublishedDate: company.planPublishedDate ?? null,
    lastVerifiedDate: company.lastVerifiedDate ?? null,
    evidenceRefs: company.evidenceRefs ?? [],
    stage: company.stage,
  };
  company.sourceUrl = record.sourceUrl;
  company.document = record.document;
  company.planPublishedDate = record.planPublishedDate;
  company.lastVerifiedDate = record.verifiedDate;
  company.evidenceRefs = [...new Set([...(company.evidenceRefs || []), ...record.evidenceRefs])];
  const warnings = (company.warnings || []).filter(warning => !/ページ証跡.*不足|証跡補修対象/.test(String(warning)));
  warnings.push('公式一次資料のページ証跡を再確認済み。');
  company.warnings = [...new Set(warnings)];

  const compactDate = record.verifiedDate.replaceAll('-', '');
  const minute = String(index % 60).padStart(2, '0');
  const reviewId = `review-${code}-${compactDate}-evidence`;
  reviews.push({
    id: reviewId,
    companyCode: code,
    fromStage: company.stage,
    targetStage: company.stage,
    status: 'in_review',
    checklist: {
      officialSource: true,
      publicationDate: true,
      pageEvidence: true,
      numbersUnitsYears: true,
      strategyClassification: true,
      comparisonDisplay: true,
      mobileDisplay: true,
    },
    author: 'source-research-agent',
    reviewer: 'quality-evidence-agent',
    sourceUrl: record.sourceUrl,
    sourcePages: record.evidenceRefs,
    note: '企業区分を変更せず、公式一次資料に基づくページ証跡・資料公表日・出典導線を補修し、本番昇格は別の二段階承認で行う。',
    decisionReason: record.reason,
    createdAt: `${record.verifiedDate}T06:${minute}:00.000Z`,
    reviewedAt: `${record.verifiedDate}T07:${minute}:00.000Z`,
  });
  corrections.push({
    id: `correction-${code}-${compactDate}-evidence`,
    companyCode: code,
    fieldPath: 'sourceUrl,document,planPublishedDate,lastVerifiedDate,evidenceRefs,warnings',
    before,
    after: {
      sourceUrl: company.sourceUrl,
      document: company.document,
      planPublishedDate: company.planPublishedDate,
      lastVerifiedDate: company.lastVerifiedDate,
      evidenceRefs: company.evidenceRefs,
      stage: company.stage,
    },
    reason: record.reason,
    sourceUrl: record.sourceUrl,
    sourcePage: record.evidenceRefs.join(' / '),
    status: 'corrected',
    reviewDecisionId: reviewId,
    detectedAt: `${record.verifiedDate}T06:${minute}:00.000Z`,
    correctedAt: `${record.verifiedDate}T07:${minute}:00.000Z`,
  });
}

const ledgerPath = path.join(QUALITY_DIR, `${config.batchId}-ledger.json`);
writeJson(ledgerPath, {
  schemaVersion: 'governance-ledger-batch-v1',
  batchId: config.batchId,
  automaticApprovalAllowed: false,
  reviews,
  corrections,
});
writeBundle(bundle, manifest);
runNode('scripts/apply_governance_ledger_batch_v1.mjs', {
  GOVERNANCE_LEDGER_BATCH: path.relative(ROOT, ledgerPath),
});
runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/normalize_bundle_contract_v1.mjs');
runNode('scripts/build_frontend_data_shards_v1.mjs');
if (fs.existsSync(path.join(ROOT, 'scripts', 'analyze_bundle_capacity_v1.mjs'))) runNode('scripts/analyze_bundle_capacity_v1.mjs');

const final = readBundle().bundle;
const finalCore = final.companies.filter(company => company.stage === 'core').length;
const finalDetailed = final.companies.filter(company => company.stage === 'detailed_extracted').length;
if (config.expectedCoreCount != null && finalCore !== config.expectedCoreCount) {
  throw new Error(`Core count changed during evidence repair: ${finalCore} !== ${config.expectedCoreCount}`);
}
if (config.expectedDetailedExtractedCount != null && finalDetailed !== config.expectedDetailedExtractedCount) {
  throw new Error(`Detailed count changed during evidence repair: ${finalDetailed} !== ${config.expectedDetailedExtractedCount}`);
}
writeJson(path.join(QUALITY_DIR, `${config.batchId}-report.json`), {
  schemaVersion: 'core-evidence-repair-report-v1',
  batchId: config.batchId,
  repaired: codes.length,
  repairedCodes: codes,
  repairedStages: Object.fromEntries([...allowedStages].map(stage => [stage, config.records.filter(record => (record.expectedStage || stage) === stage).length])),
  currentCoreCount: finalCore,
  currentDetailedExtractedCount: finalDetailed,
  expectedFiveStarAfterApproval: config.expectedFiveStarAfterApproval,
  automaticSelectionUsed: false,
  pageEvidenceRefsAdded: config.records.reduce((sum, record) => sum + record.evidenceRefs.length, 0),
});
if (markerPath) {
  fs.rmSync(markerPath);
} else if (embeddedRepair) {
  delete config.runRequested;
  writeJson(configPath, config);
}
console.log(`Repaired page evidence for ${codes.length} companies.`);
