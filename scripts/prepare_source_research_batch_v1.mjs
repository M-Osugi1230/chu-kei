import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const REQUEST_PATH = path.resolve(
  process.env.SOURCE_RESEARCH_BATCH_REQUEST
    || 'operations/source-research/source-research-batch-request.json',
);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))),
  );
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error('Bundle SHA-256 mismatch');
  return { manifest, bundle: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
}

function companyScore(company) {
  const marketScore = { Prime: 30, Growth: 24, Standard: 18 }[company.market] || 10;
  const industry = String(company.industry || '');
  let industryScore = 0;
  for (const [pattern, score] of [
    [/情報・通信|電気機器|機械|精密機器/, 20],
    [/サービス|医薬品|化学|輸送用機器/, 18],
    [/銀行|証券|保険|その他金融|不動産|卸売/, 16],
    [/小売|建設|陸運|海運|空運|倉庫/, 14],
    [/食料品|金属|鉄鋼|非鉄/, 12],
  ]) {
    if (pattern.test(industry)) {
      industryScore = score;
      break;
    }
  }
  const groupBonus = /ホールディングス|グループ|HD/i.test(String(company.name || '')) ? 8 : 0;
  return marketScore + industryScore + groupBonus;
}

const request = readJson(REQUEST_PATH);
if (request.schemaVersion !== 'source-research-batch-request-v1') {
  throw new Error(`Unsupported request schema: ${request.schemaVersion}`);
}
if (!/^source-research-batch-\d+$/.test(request.batchId || '')) {
  throw new Error(`Invalid batchId: ${request.batchId}`);
}
if (!Number.isInteger(request.batchSize) || request.batchSize < 1 || request.batchSize > 300) {
  throw new Error('batchSize must be an integer from 1 to 300');
}
if (!request.outputConfigPath || !request.outputCandidatePath) {
  throw new Error('outputConfigPath and outputCandidatePath are required');
}

const excluded = new Set((request.excludeCodes || []).map(String));
const exclusionReports = [];
for (const relativePath of request.excludeCandidateReports || []) {
  const reportPath = path.resolve(relativePath);
  if (!fs.existsSync(reportPath)) throw new Error(`Exclusion report not found: ${relativePath}`);
  const report = readJson(reportPath);
  if (report.schemaVersion !== 'source-research-candidates-v1') {
    throw new Error(`Unsupported exclusion report: ${relativePath}`);
  }
  const codes = (report.selectedCodes || []).map(String);
  codes.forEach(code => excluded.add(code));
  exclusionReports.push({
    path: path.relative(ROOT, reportPath),
    batchId: report.batchId,
    selectedCount: codes.length,
  });
}

const { manifest, bundle } = readBundle();
const eligible = (bundle.companies || [])
  .filter(company => company.stage === 'jpx_indexed')
  .filter(company => !excluded.has(String(company.code)))
  .sort((a, b) => (
    companyScore(b) - companyScore(a)
    || String(a.code).localeCompare(String(b.code), 'ja')
  ));
const selected = eligible.slice(0, request.batchSize);
if (!selected.length) throw new Error('No unresearched jpx_indexed companies remain');

const outputConfigPath = path.resolve(request.outputConfigPath);
if (fs.existsSync(outputConfigPath)) {
  const existing = readJson(outputConfigPath);
  if (existing.runRequested === true) {
    throw new Error(`Research config is already pending: ${request.outputConfigPath}`);
  }
}
const config = {
  schemaVersion: 'source-research-batch-v1',
  batchId: request.batchId,
  runRequested: true,
  codes: selected.map(company => String(company.code)),
  concurrency: Math.max(1, Math.min(Number(request.concurrency || 12), 12)),
  outputPath: request.outputCandidatePath,
  selectionPolicy: {
    stage: 'jpx_indexed',
    explicitCodesPreparedFromBundle: true,
    scorePolicy: 'market-industry-holding-company-v1',
    excludedCodeCount: excluded.size,
    exclusionReports,
  },
  safety: {
    automaticFactCompletion: false,
    automaticApproval: false,
    automaticProductionPromotion: false,
    requireJpxCodeSpecificDisclosure: true,
    requirePdfPageEvidence: true,
    requirePublicationDate: true,
    requireIdentityMatchBeforeApproval: true,
    automaticConnectedStatusAllowed: false,
  },
};
writeJson(outputConfigPath, config);

const reportPath = path.join(
  ROOT,
  'operations',
  'source-research',
  `${request.batchId}-selection-report.json`,
);
writeJson(reportPath, {
  schemaVersion: 'source-research-selection-report-v1',
  generatedAt: new Date().toISOString(),
  batchId: request.batchId,
  sourceBundleSha256: manifest.sha256,
  currentJpxIndexedCount: bundle.companies.filter(company => company.stage === 'jpx_indexed').length,
  excludedCodeCount: excluded.size,
  remainingUnresearchedCount: eligible.length,
  requestedCount: request.batchSize,
  selectedCount: selected.length,
  selectedCodes: selected.map(company => String(company.code)),
  exclusionReports,
  outputConfigPath: path.relative(ROOT, outputConfigPath),
});

console.log(JSON.stringify({
  batchId: request.batchId,
  currentJpxIndexedCount: bundle.companies.filter(company => company.stage === 'jpx_indexed').length,
  excludedCodeCount: excluded.size,
  remainingUnresearchedCount: eligible.length,
  selectedCount: selected.length,
  outputConfigPath: path.relative(ROOT, outputConfigPath),
}, null, 2));
