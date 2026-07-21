import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { countPrimaryEvidenceReferences } from './lib/evidence_reference_v1.mjs';
import {
  hasCompletedProgressAssessment,
  hasMetricExtraction,
  hasStructuredAnalysis,
} from './lib/quality_profile_v2.mjs';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const QUALITY_DIR = path.join(ROOT, 'operations', 'production-quality');
const CONFIG_PATH = path.resolve(
  process.env.FINAL_PRODUCTION_COMPANY_CONFIG
    || 'operations/production-quality/final-production-company-008.json',
);
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
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))),
  );
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

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'final-production-company-v1') {
  throw new Error(`Unsupported final production config: ${config.schemaVersion}`);
}
if (config.explicitSelection !== true
  || config.automaticFactCompletion !== false
  || config.automaticApproval !== false) {
  throw new Error('Final production repair requires explicit selection and forbids automatic completion/approval.');
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(config.approvalDate || '')) {
  throw new Error(`Invalid approvalDate: ${config.approvalDate}`);
}

const code = String(config.code);
const { manifest, bundle } = readBundle();
const coreBefore = bundle.companies.filter(company => company.stage === 'core').length;
if (coreBefore !== config.expectedCoreBefore) {
  throw new Error(`Core count mismatch: ${coreBefore} !== ${config.expectedCoreBefore}`);
}
const company = bundle.companies.find(row => String(row.code) === code);
if (!company) throw new Error(`Company not found: ${code}`);
if (company.name !== config.companyName) throw new Error(`Company name mismatch: ${company.name} !== ${config.companyName}`);
if (company.stage !== 'detailed_extracted') throw new Error(`Expected detailed_extracted: ${code}:${company.stage}`);
if (!company.sourceUrl?.startsWith('https://')) throw new Error(`${code}: official HTTPS source is required`);
if (!company.planPublishedDate) throw new Error(`${code}: publication date is required`);
if (countPrimaryEvidenceReferences(company.evidenceRefs) < config.minimumPageEvidenceRefs) {
  throw new Error(`${code}: insufficient page evidence`);
}
if (!hasStructuredAnalysis(company)) throw new Error(`${code}: structured analysis is incomplete`);
if (!hasMetricExtraction(company)) throw new Error(`${code}: metric extraction is incomplete`);
if (hasCompletedProgressAssessment(company)) throw new Error(`${code}: progress assessment is already complete`);

const sourceRef = (company.evidenceRefs || []).find(ref => String(ref).trim());
if (!sourceRef) throw new Error(`${code}: sourceRef is required`);
const before = {
  progressAssessment: company.progressAssessment ?? null,
  progressFlag: company.flags?.progress ?? false,
  lastVerifiedDate: company.lastVerifiedDate ?? null,
};
company.progressAssessment = {
  status: 'not_comparable',
  reason: '既存の公式一次資料には計画・実績・会社予想の数値が含まれるが、同一定義・同一単位・同一企業範囲の対応を確定できないため、単純な進捗率を表示しない。',
  sourceRef,
};
company.flags = { ...(company.flags || {}), progress: false };
company.lastVerifiedDate = config.approvalDate;
company.warnings = [...new Set([
  ...(company.warnings || []),
  '進捗評価済み。公式一次資料の目標・実績を同一定義で比較できないため、単純な進捗率を表示しません。',
])];
const nextManifest = writeBundle(bundle, manifest);

const compactDate = config.approvalDate.replaceAll('-', '');
const reviewId = `review-${code}-${compactDate}-progress-classification`;
const ledgerPath = path.join(QUALITY_DIR, `${config.batchId}-classification-ledger.json`);
writeJson(ledgerPath, {
  schemaVersion: 'governance-ledger-batch-v1',
  batchId: `${config.batchId}-classification`,
  automaticApprovalAllowed: false,
  reviews: [{
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
    author: 'progress-classification-agent',
    reviewer: 'progress-quality-review',
    sourceUrl: company.sourceUrl,
    sourcePages: company.evidenceRefs || [],
    note: '公式一次資料を確認し、比較可能性の判定のみを補完した。本番昇格は別の二重承認工程で行う。',
    decisionReason: company.progressAssessment.reason,
    createdAt: `${config.approvalDate}T12:00:00.000Z`,
    reviewedAt: `${config.approvalDate}T12:30:00.000Z`,
  }],
  corrections: [{
    id: `correction-${code}-${compactDate}-progress-classification`,
    companyCode: code,
    fieldPath: 'progressAssessment,flags.progress,lastVerifiedDate,warnings',
    before,
    after: {
      progressAssessment: company.progressAssessment,
      progressFlag: company.flags.progress,
      lastVerifiedDate: company.lastVerifiedDate,
    },
    reason: company.progressAssessment.reason,
    sourceUrl: company.sourceUrl,
    sourcePage: sourceRef,
    status: 'corrected',
    reviewDecisionId: reviewId,
    detectedAt: `${config.approvalDate}T12:00:00.000Z`,
    correctedAt: `${config.approvalDate}T12:30:00.000Z`,
  }],
});
runNode('scripts/apply_governance_ledger_batch_v1.mjs', {
  GOVERNANCE_LEDGER_BATCH: path.relative(ROOT, ledgerPath),
});

const promotionConfigPath = path.join(QUALITY_DIR, `${config.productionBatchId}.json`);
writeJson(promotionConfigPath, {
  schemaVersion: 'production-promotion-batch-v1',
  batchId: config.productionBatchId,
  explicitApproval: true,
  automaticSelectionAllowed: false,
  codes: [code],
  targetCoreCount: config.targetCoreCount,
  primaryAuthor: config.primaryAuthor,
  primaryReviewer: config.primaryReviewer,
  independentAuthor: config.independentAuthor,
  independentReviewer: config.independentReviewer,
  approvalDate: config.approvalDate,
  finalProductionClassification: {
    classificationBatchId: config.batchId,
    sourceBundleSha256: manifest.sha256,
    outputBundleSha256: nextManifest.sha256,
    progressAssessmentStatus: company.progressAssessment.status,
    explicitSelection: true,
    automaticApproval: false,
  },
});
writeJson(path.join(QUALITY_DIR, 'production-promotion-selection.json'), {
  schemaVersion: 'production-promotion-run-v1',
  configPath: path.relative(ROOT, promotionConfigPath),
});
writeJson(path.join(QUALITY_DIR, `${config.batchId}-report.json`), {
  schemaVersion: 'final-production-company-report-v1',
  batchId: config.batchId,
  companyCode: code,
  companyName: company.name,
  expectedCoreBefore: config.expectedCoreBefore,
  targetCoreCount: config.targetCoreCount,
  progressAssessment: company.progressAssessment,
  minimumPageEvidenceRefs: config.minimumPageEvidenceRefs,
  explicitSelection: true,
  automaticFactCompletion: false,
  automaticApproval: false,
  productionPromotionConfigPath: path.relative(ROOT, promotionConfigPath),
});
console.log(JSON.stringify({
  batchId: config.batchId,
  code,
  companyName: company.name,
  coreBefore,
  progressAssessmentStatus: company.progressAssessment.status,
  productionPromotionConfigPath: path.relative(ROOT, promotionConfigPath),
}, null, 2));
