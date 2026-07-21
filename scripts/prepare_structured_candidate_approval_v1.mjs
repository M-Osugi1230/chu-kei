import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const CONFIG_PATH = path.resolve(
  process.env.SOURCE_RESEARCH_APPROVAL_CONFIG
    || 'operations/source-research/source-research-approval.json',
);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'source-research-approval-v1') {
  throw new Error(`Unsupported approval schema: ${config.schemaVersion}`);
}
if (config.explicitApproval !== true) {
  throw new Error('explicitApproval=true is required');
}
if (config.automaticSelectionAllowed !== false) {
  throw new Error('automaticSelectionAllowed must be false');
}
if (!Array.isArray(config.codes) || config.codes.length === 0) {
  throw new Error('A non-empty explicit codes array is required');
}
if (new Set(config.codes.map(String)).size !== config.codes.length) {
  throw new Error('Duplicate company codes are not allowed');
}
if (!config.candidatePath || !config.structuredBatchId || !config.structuredConfigPath) {
  throw new Error('candidatePath, structuredBatchId and structuredConfigPath are required');
}
if (!/^structured-expansion-batch-\d+$/.test(config.structuredBatchId)) {
  throw new Error(`Invalid structuredBatchId: ${config.structuredBatchId}`);
}
if (!/^\d{8}$/.test(config.dateTag || '')) throw new Error('dateTag must be YYYYMMDD');
if (!/^\d{4}-\d{2}-\d{2}$/.test(config.lastVerifiedDate || '')) {
  throw new Error('lastVerifiedDate must be YYYY-MM-DD');
}
if (!Number.isInteger(config.targetStructuredCount) || config.targetStructuredCount <= 0) {
  throw new Error('targetStructuredCount must be a positive integer');
}

const candidatePath = path.resolve(config.candidatePath);
const candidates = readJson(candidatePath);
if (candidates.schemaVersion !== 'source-research-candidates-v1') {
  throw new Error(`Unsupported candidate schema: ${candidates.schemaVersion}`);
}
if (candidates.automaticFactCompletion !== false || candidates.automaticApproval !== false) {
  throw new Error('Candidate report must explicitly prohibit automatic completion and approval');
}

const candidateByCode = new Map(
  (candidates.results || []).map(row => [String(row.code), row]),
);
const records = [];
for (const codeValue of config.codes) {
  const code = String(codeValue);
  const candidate = candidateByCode.get(code);
  if (!candidate) throw new Error(`${code}: candidate not found`);
  if (candidate.status !== 'eligible') throw new Error(`${code}: candidate is not eligible (${candidate.status})`);
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < (config.minimumConfidence || 80)) {
    throw new Error(`${code}: confidence is below threshold (${candidate.confidence})`);
  }
  if (candidate.identityMatch !== true) throw new Error(`${code}: company identity was not confirmed`);
  if (!candidate.record || String(candidate.record.code) !== code) {
    throw new Error(`${code}: candidate record is missing or mismatched`);
  }
  if (!Array.isArray(candidate.record.evidenceRefs) || candidate.record.evidenceRefs.length < 2) {
    throw new Error(`${code}: at least two evidence references are required`);
  }
  if (!candidate.record.planPublishedDate) throw new Error(`${code}: publication date is required`);
  records.push(candidate.record);
}

const structuredConfig = {
  schemaVersion: 'structured-expansion-batch-config-v2',
  batchId: config.structuredBatchId,
  patchPrefix: config.patchPrefix || config.structuredBatchId.replace('structured-expansion-', ''),
  runRequested: true,
  dateTag: config.dateTag,
  lastVerifiedDate: config.lastVerifiedDate,
  createdAtBase: config.createdAtBase,
  reviewedAtBase: config.reviewedAtBase,
  targetStructuredCount: config.targetStructuredCount,
  expectedCompanyCount: config.expectedCompanyCount || 1200,
  expectedSourceConfirmed: config.expectedSourceConfirmed,
  fromStage: 'jpx_indexed',
  targetStage: 'detailed_extracted',
  sourceResearch: {
    candidatePath: path.relative(ROOT, candidatePath),
    approvalPath: path.relative(ROOT, CONFIG_PATH),
    minimumConfidence: config.minimumConfidence || 80,
    explicitCodes: config.codes.map(String),
    automaticSelectionAllowed: false,
  },
  records,
};

const outputPath = path.resolve(config.structuredConfigPath);
if (fs.existsSync(outputPath)) {
  const existing = readJson(outputPath);
  const existingCodes = (existing.records || []).map(row => String(row.code));
  const nextCodes = records.map(row => String(row.code));
  if (JSON.stringify(existingCodes) !== JSON.stringify(nextCodes)) {
    throw new Error(`Refusing to overwrite ${path.relative(ROOT, outputPath)} with different company codes`);
  }
}
writeJson(outputPath, structuredConfig);

const reportPath = path.join(
  ROOT,
  'operations',
  'source-research',
  `${config.approvalId || path.basename(CONFIG_PATH, '.json')}-report.json`,
);
writeJson(reportPath, {
  schemaVersion: 'source-research-approval-report-v1',
  approvalId: config.approvalId || path.basename(CONFIG_PATH, '.json'),
  candidatePath: path.relative(ROOT, candidatePath),
  structuredConfigPath: path.relative(ROOT, outputPath),
  explicitApproval: true,
  automaticSelectionAllowed: false,
  approvedCount: records.length,
  approvedCodes: records.map(row => String(row.code)),
  minimumConfidence: config.minimumConfidence || 80,
});

console.log(JSON.stringify({
  approvalConfig: path.relative(ROOT, CONFIG_PATH),
  structuredConfig: path.relative(ROOT, outputPath),
  approvedCount: records.length,
  approvedCodes: records.map(row => String(row.code)),
}, null, 2));
