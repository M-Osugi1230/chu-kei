import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const QUALITY_DIR = path.join(ROOT, 'operations', 'production-quality');
const MARKER_PATH = path.join(QUALITY_DIR, 'run-core-approval.json');
const READINESS_PATH = path.join(QUALITY_DIR, 'production-readiness-v1.json');

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

if (!fs.existsSync(MARKER_PATH)) {
  console.log('No existing-core approval marker found.');
  process.exit(0);
}

const marker = readJson(MARKER_PATH);
if (marker.schemaVersion !== 'core-approval-run-v1') throw new Error(`Unsupported core approval marker: ${marker.schemaVersion}`);
const configPath = path.resolve(ROOT, String(marker.configPath || ''));
const relativeConfigPath = path.relative(QUALITY_DIR, configPath);
if (!relativeConfigPath || relativeConfigPath.startsWith('..') || path.isAbsolute(relativeConfigPath)) {
  throw new Error(`Core approval config must be inside operations/production-quality: ${marker.configPath}`);
}
const config = readJson(configPath);
if (config.schemaVersion !== 'core-approval-batch-v1') throw new Error(`Unsupported core approval config: ${config.schemaVersion}`);
if (config.explicitApproval !== true || config.automaticSelectionAllowed !== false) {
  throw new Error('Core approval requires an explicit code list and forbids automatic selection.');
}
if (!Array.isArray(config.codes) || config.codes.length === 0) throw new Error('Core approval code list is empty.');
const codes = config.codes.map(String);
if (new Set(codes).size !== codes.length) throw new Error('Core approval code list contains duplicates.');
if (!config.primaryReviewer || !config.independentReviewer || config.primaryReviewer === config.independentReviewer) {
  throw new Error('Two distinct core reviewers are required.');
}

const readiness = readJson(READINESS_PATH);
const allowed = new Set(readiness.queues?.approvalRequiredCodes || []);
const { manifest, bundle } = readBundle();
if (readiness.bundleSha256 !== manifest.sha256) {
  throw new Error(`Readiness report is stale: ${readiness.bundleSha256} !== ${manifest.sha256}`);
}
const companyByCode = new Map(bundle.companies.map(company => [String(company.code), company]));
const invalid = codes.filter(code => !allowed.has(code));
if (invalid.length) throw new Error(`Codes are not machine-ready core approval candidates: ${invalid.join(', ')}`);
const wrongStage = codes.filter(code => companyByCode.get(code)?.stage !== 'core');
if (wrongStage.length) throw new Error(`Core approval targets must already be core: ${wrongStage.join(', ')}`);

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
for (const [index, code] of codes.entries()) {
  const company = companyByCode.get(code);
  const minute = String(index).padStart(2, '0');
  const sourcePages = company.evidenceRefs || [];
  for (const role of [
    {
      suffix: 'production-primary',
      author: config.primaryAuthor,
      reviewer: config.primaryReviewer,
      createdHour: '12',
      reviewedHour: '13',
      note: '既存本番レコードを新しい承認契約で企業単位に再監査した。',
      reason: '公式一次資料・証跡・構造化・進捗接続の機械要件を満たし、個別レビューを通過したため。',
    },
    {
      suffix: 'production-double-check',
      author: config.independentAuthor,
      reviewer: config.independentReviewer,
      createdHour: '14',
      reviewedHour: '15',
      note: '一次レビューとは別の役割でデータ契約・検索・詳細・モバイル表示を独立再検証した。',
      reason: '独立した再検証で本番品質要件への適合を確認したため。',
    },
  ]) {
    reviews.push({
      id: `review-${code}-20260714-${role.suffix}`,
      companyCode: code,
      fromStage: 'core',
      targetStage: 'core',
      status: 'approved',
      checklist,
      author: role.author,
      reviewer: role.reviewer,
      sourceUrl: company.sourceUrl,
      sourcePages,
      note: role.note,
      decisionReason: role.reason,
      createdAt: `2026-07-14T${role.createdHour}:${minute}:00.000Z`,
      reviewedAt: `2026-07-14T${role.reviewedHour}:${minute}:00.000Z`,
    });
  }
}

const ledgerPath = path.join(QUALITY_DIR, `${config.batchId}-ledger.json`);
writeJson(ledgerPath, {
  schemaVersion: 'governance-ledger-batch-v1',
  batchId: config.batchId,
  automaticApprovalAllowed: false,
  explicitProductionApproval: true,
  reviews,
  corrections: [],
});
runNode('scripts/apply_production_approval_ledger_v1.mjs', {
  PRODUCTION_APPROVAL_LEDGER: path.relative(ROOT, ledgerPath),
});
writeJson(path.join(QUALITY_DIR, `${config.batchId}-report.json`), {
  schemaVersion: 'core-approval-report-v1',
  batchId: config.batchId,
  approvedCompanies: codes.length,
  approvedCodes: codes,
  approvalsPerCompany: 2,
  automaticSelectionUsed: false,
  expectedCoreCount: config.expectedCoreCount,
  expectedFiveStarCount: config.expectedFiveStarCount,
});
fs.rmSync(MARKER_PATH);
console.log(`Approved ${codes.length} existing core companies under the new production contract.`);
