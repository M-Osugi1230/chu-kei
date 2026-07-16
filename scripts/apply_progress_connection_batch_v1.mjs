import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const QUALITY_DIR = path.join(ROOT, 'operations', 'production-quality');
const MILESTONE_PATH = path.join(ROOT, 'operations', 'quality', 'coverage-milestone-v1.json');
const LEGACY_MARKER_PATHS = [
  path.join(QUALITY_DIR, 'progress-connection-selection.json'),
  path.join(QUALITY_DIR, 'run-progress-connection-batch.json'),
];
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

function findMarkerPath() {
  const numbered = fs.readdirSync(QUALITY_DIR)
    .filter(file => /^batch-\d+-selection\.json$/.test(file))
    .sort((a, b) => Number(b.match(/\d+/)?.[0] || 0) - Number(a.match(/\d+/)?.[0] || 0))
    .map(file => path.join(QUALITY_DIR, file));
  return [...numbered, ...LEGACY_MARKER_PATHS].find(file => fs.existsSync(file));
}

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

const markerPath = findMarkerPath();
if (!markerPath) {
  console.log('No progress connection marker found.');
  process.exit(0);
}

const marker = readJson(markerPath);
if (marker.schemaVersion !== 'progress-connection-run-v1') throw new Error(`Unsupported marker: ${marker.schemaVersion}`);
const configPath = path.resolve(ROOT, String(marker.configPath || ''));
const relativeConfigPath = path.relative(QUALITY_DIR, configPath);
if (!relativeConfigPath || relativeConfigPath.startsWith('..') || path.isAbsolute(relativeConfigPath)) {
  throw new Error(`Progress config must be inside operations/production-quality: ${marker.configPath}`);
}
const config = readJson(configPath);
if (config.schemaVersion !== 'progress-connection-batch-v1') throw new Error(`Unsupported config: ${config.schemaVersion}`);
if (config.explicitSelection !== true || config.automaticFactCompletion !== false || config.automaticApproval !== false) {
  throw new Error('Explicit selection is required and automatic fact completion/approval must be false.');
}
if (!Array.isArray(config.records) || config.records.length === 0) throw new Error('Progress connection records are empty.');

const { manifest, bundle } = readBundle();
const companyByCode = new Map(bundle.companies.map(company => [String(company.code), company]));
const existingKeys = new Set((bundle.progress || []).map(row => [row.code, row.fiscalYear, row.metric, row.actualFiscalYear ?? ''].join('|')));
const reviews = [];
const corrections = [];
const addedRows = [];

for (const [index, record] of config.records.entries()) {
  const code = String(record.code);
  const company = companyByCode.get(code);
  if (!company) throw new Error(`Company not found: ${code}`);
  if (company.stage !== 'detailed_extracted') throw new Error(`Progress target must be detailed_extracted: ${code}:${company.stage}`);
  if (!record.sourceUrl?.startsWith('https://')) throw new Error(`Official HTTPS source is required: ${code}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.sourcePublishedDate || '')) throw new Error(`sourcePublishedDate is required: ${code}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.verifiedDate || '')) throw new Error(`verifiedDate is required: ${code}`);
  if (!Array.isArray(record.progressRows) || record.progressRows.length === 0) throw new Error(`progressRows are required: ${code}`);
  if (!record.reason || String(record.reason).length < 20) throw new Error(`Detailed reason is required: ${code}`);

  const before = {
    progressFlag: company.flags?.progress ?? false,
    lastVerifiedDate: company.lastVerifiedDate ?? null,
    progressRows: (bundle.progress || []).filter(row => String(row.code) === code),
  };

  for (const row of record.progressRows) {
    if (row.fiscalYear == null || !row.metric) throw new Error(`fiscalYear and metric are required: ${code}`);
    if (typeof row.targetValue !== 'number' || typeof row.actualValue !== 'number') throw new Error(`Numeric targetValue and actualValue are required: ${code}:${row.metric}`);
    if (!row.unit) throw new Error(`Unit is required: ${code}:${row.metric}`);
    if (!row.sourcePage || !/(?:p\.?\s*\d|ページ\s*\d|公式Webページ|Web画像)/i.test(String(row.sourcePage))) {
      throw new Error(`Page or official Web evidence is required: ${code}:${row.metric}`);
    }
    if (!row.actualFiscalYear) throw new Error(`actualFiscalYear is required: ${code}:${row.metric}`);
    const key = [code, row.fiscalYear, row.metric, row.actualFiscalYear].join('|');
    if (existingKeys.has(key)) throw new Error(`Duplicate progress row: ${key}`);
    const progressRate = row.targetValue === 0 ? null : Number(((row.actualValue / row.targetValue) * 100).toFixed(1));
    const nextRow = {
      code,
      fiscalYear: row.fiscalYear,
      metric: row.metric,
      targetValue: row.targetValue,
      actualValue: row.actualValue,
      unit: row.unit,
      progressRate,
      source: row.targetSource || company.document || '中期経営計画',
      sourceUrl: record.sourceUrl,
      sourcePage: row.sourcePage,
      updatedAt: record.verifiedDate,
      lastVerifiedDate: record.verifiedDate,
      note: row.note || '公式一次資料の実績値を中期経営計画の同一定義目標へ接続。',
      actualFiscalYear: row.actualFiscalYear,
      actualSource: row.actualSource || `${record.document} ${row.sourcePage}`,
    };
    bundle.progress.push(nextRow);
    existingKeys.add(key);
    addedRows.push(nextRow);
  }

  company.flags = { ...(company.flags || {}), progress: true };
  company.lastVerifiedDate = record.verifiedDate;
  company.warnings = [...new Set([...(company.warnings || []).filter(warning => !/進捗.*未接続/.test(String(warning))), '公式一次資料の実績値を中計目標へ接続済み。'])];

  const compactDate = record.verifiedDate.replaceAll('-', '');
  const reviewId = `review-${code}-${compactDate}-progress-connect`;
  reviews.push({
    id: reviewId,
    companyCode: code,
    fromStage: 'detailed_extracted',
    targetStage: 'detailed_extracted',
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
    author: 'progress-research-agent',
    reviewer: 'progress-quality-agent',
    sourceUrl: record.sourceUrl,
    sourcePages: record.progressRows.map(row => String(row.sourcePage)),
    note: '公式実績値を中計目標へ接続したが、本番昇格は別の承認工程で行う。',
    decisionReason: record.reason,
    createdAt: `${record.verifiedDate}T01:${String(index).padStart(2, '0')}:00.000Z`,
    reviewedAt: `${record.verifiedDate}T01:${String(index + 10).padStart(2, '0')}:00.000Z`,
  });
  corrections.push({
    id: `correction-${code}-${compactDate}-progress-connect`,
    companyCode: code,
    fieldPath: 'flags.progress,lastVerifiedDate,progress',
    before,
    after: {
      progressFlag: true,
      lastVerifiedDate: company.lastVerifiedDate,
      progressRows: bundle.progress.filter(row => String(row.code) === code),
    },
    reason: record.reason,
    sourceUrl: record.sourceUrl,
    sourcePage: record.progressRows.map(row => String(row.sourcePage)).join(' / '),
    status: 'corrected',
    reviewDecisionId: reviewId,
    detectedAt: `${record.verifiedDate}T01:${String(index).padStart(2, '0')}:00.000Z`,
    correctedAt: `${record.verifiedDate}T01:${String(index + 20).padStart(2, '0')}:00.000Z`,
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
const milestone = readJson(MILESTONE_PATH);
milestone.progressRows = bundle.progress.length;
writeJson(MILESTONE_PATH, milestone);
runNode('scripts/apply_governance_ledger_batch_v1.mjs', {
  GOVERNANCE_LEDGER_BATCH: path.relative(ROOT, ledgerPath),
});
runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/normalize_bundle_contract_v1.mjs');
runNode('scripts/build_frontend_data_shards_v1.mjs');
if (fs.existsSync(path.join(ROOT, 'scripts', 'analyze_bundle_capacity_v1.mjs'))) runNode('scripts/analyze_bundle_capacity_v1.mjs');

writeJson(path.join(QUALITY_DIR, `${config.batchId}-report.json`), {
  schemaVersion: 'progress-connection-report-v1',
  batchId: config.batchId,
  connectedCompanies: config.records.length,
  connectedCodes: config.records.map(record => String(record.code)),
  progressRowsAdded: addedRows.length,
  resultingProgressRows: bundle.progress.length,
  automaticFactCompletion: false,
  automaticApproval: false,
});
fs.rmSync(markerPath);
console.log(`Connected official progress data for ${config.records.length} companies (${addedRows.length} rows).`);
