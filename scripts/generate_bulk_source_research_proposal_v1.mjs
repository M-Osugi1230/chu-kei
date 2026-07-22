import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const CONFIG_PATH = path.resolve(
  process.env.SOURCE_RESEARCH_PROPOSAL_CONFIG
    || 'operations/source-research/source-research-proposal-config.json',
);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'source-research-proposal-config-v1') {
  throw new Error(`Unsupported proposal config: ${config.schemaVersion}`);
}

const configuredCandidatePaths = Array.isArray(config.candidatePaths)
  ? config.candidatePaths
  : [config.candidatePath].filter(Boolean);
if (!configuredCandidatePaths.length) {
  throw new Error('candidatePath or candidatePaths is required');
}

const sourceReports = configuredCandidatePaths.map(relativePath => {
  const candidatePath = path.resolve(relativePath);
  if (!fs.existsSync(candidatePath)) throw new Error(`Candidate report not found: ${relativePath}`);
  const report = readJson(candidatePath);
  if (report.schemaVersion !== 'source-research-candidates-v1') {
    throw new Error(`Unsupported candidate report: ${relativePath}`);
  }
  return { candidatePath, report };
});

const sourceBundleSha256s = [...new Set(sourceReports.map(({ report }) => report.sourceBundleSha256))];
if (sourceBundleSha256s.length !== 1 || !sourceBundleSha256s[0]) {
  throw new Error(`Candidate reports must share one source bundle SHA-256: ${sourceBundleSha256s.join(', ')}`);
}

const resultByCode = new Map();
const selectedCodes = [];
for (const { report, candidatePath } of sourceReports) {
  for (const candidate of report.results || []) {
    const code = String(candidate.code);
    if (resultByCode.has(code)) {
      throw new Error(`Duplicate candidate code across reports: ${code}`);
    }
    resultByCode.set(code, candidate);
  }
  for (const rawCode of report.selectedCodes || []) {
    const code = String(rawCode);
    if (!selectedCodes.includes(code)) selectedCodes.push(code);
  }
  if ((report.results || []).length !== Number(report.selectedCount || 0)) {
    throw new Error(`Candidate selectedCount mismatch: ${path.relative(ROOT, candidatePath)}`);
  }
}

const aggregateBatchId = String(
  config.aggregateBatchId
    || (sourceReports.length === 1
      ? sourceReports[0].report.batchId
      : `source-research-aggregate-${sourceReports.length}`),
);

let candidatePath;
let report;
if (sourceReports.length === 1) {
  candidatePath = sourceReports[0].candidatePath;
  report = sourceReports[0].report;
} else {
  if (!config.mergedCandidateOutputPath) {
    throw new Error('mergedCandidateOutputPath is required when candidatePaths contains multiple reports');
  }
  candidatePath = path.resolve(config.mergedCandidateOutputPath);
  const results = [...resultByCode.values()].sort((left, right) => String(left.code).localeCompare(String(right.code), 'ja'));
  report = {
    schemaVersion: 'source-research-candidates-v1',
    batchId: aggregateBatchId,
    generatedAt: new Date().toISOString(),
    sourceBundleSha256: sourceBundleSha256s[0],
    automaticFactCompletion: false,
    automaticApproval: false,
    selectedCount: results.length,
    eligibleCount: results.filter(candidate => candidate.status === 'eligible').length,
    needsReviewCount: results.filter(candidate => candidate.status === 'needs_review').length,
    failureCount: results.filter(candidate => !['eligible', 'needs_review'].includes(candidate.status)).length,
    selectedCodes: results.map(candidate => String(candidate.code)),
    eligibleCodes: results.filter(candidate => candidate.status === 'eligible').map(candidate => String(candidate.code)),
    sourceReports: sourceReports.map(({ candidatePath: sourcePath, report: sourceReport }) => ({
      path: path.relative(ROOT, sourcePath),
      batchId: sourceReport.batchId,
      selectedCount: sourceReport.selectedCount,
    })),
    results,
  };
  writeJson(candidatePath, report);
}

const minimumConfidence = Number(config.minimumConfidence || 93);
const minimumDate = String(config.minimumPublicationDate || '2024-01-01');
const allowedStatuses = new Set(config.allowedStatuses || ['eligible']);
const allowedDocumentPattern = new RegExp(
  config.allowedDocumentPattern
    || '中期|中長期|長期経営|事業計画|経営計画|経営戦略|成長戦略|経営方針|決算説明|決算補足|決算短信|統合報告',
);
const maximumProposedCount = config.maximumProposedCount == null
  ? null
  : Number(config.maximumProposedCount);
if (maximumProposedCount != null
  && (!Number.isInteger(maximumProposedCount) || maximumProposedCount <= 0)) {
  throw new Error(`Invalid maximumProposedCount: ${config.maximumProposedCount}`);
}

const evaluations = (report.results || []).map(candidate => {
  const record = candidate.record || {};
  const document = candidate.document || {};
  const evidenceRefs = record.evidenceRefs || [];
  const checks = {
    allowedStatus: allowedStatuses.has(candidate.status),
    officialJpxPdf: /^https:\/\/www2\.jpx\.co\.jp\/disc\//.test(document.url || record.sourceUrl || ''),
    identityMatch: candidate.identityMatch === true,
    confidence: Number(candidate.confidence || 0) >= minimumConfidence,
    publicationDate: Boolean(document.date && document.date >= minimumDate),
    documentType: allowedDocumentPattern.test(String(document.title || '')),
    pageEvidence: evidenceRefs.filter(ref => /公式PDF p\.\d+/.test(String(ref))).length >= 2,
    pageCount: Number(candidate.pageCount || 0) >= 2,
    themes: Array.isArray(record.themes) && record.themes.length >= 2,
    structuredSummary: typeof record.summary === 'string' && record.summary.length >= 20,
    progressGuard: record.progressAssessment?.status !== 'connected',
  };
  return {
    code: String(candidate.code),
    name: candidate.name,
    documentDate: document.date || null,
    documentTitle: document.title || null,
    documentUrl: document.url || record.sourceUrl || null,
    confidence: candidate.confidence ?? null,
    checks,
    approvedByRules: Object.values(checks).every(Boolean),
  };
});

const qualifiedRows = evaluations
  .filter(row => row.approvedByRules)
  .sort((a, b) => a.code.localeCompare(b.code, 'ja'));
const approvedRows = maximumProposedCount == null
  ? qualifiedRows
  : qualifiedRows.slice(0, maximumProposedCount);
const codes = approvedRows.map(row => row.code);
const proposalIdentity = {
  schemaVersion: 'source-research-bulk-proposal-identity-v1',
  batchId: report.batchId,
  sourceBundleSha256: report.sourceBundleSha256,
  candidatePath: path.relative(ROOT, candidatePath),
  minimumConfidence,
  minimumPublicationDate: minimumDate,
  maximumProposedCount,
  codes,
};
const proposalSha256 = sha256(proposalIdentity);
const outputPath = path.resolve(config.outputPath);
writeJson(outputPath, {
  schemaVersion: 'source-research-bulk-proposal-v1',
  generatedAt: new Date().toISOString(),
  proposalSha256,
  automaticApproval: false,
  automaticProductionPromotion: false,
  candidatePath: path.relative(ROOT, candidatePath),
  sourceCandidatePaths: sourceReports.map(({ candidatePath: sourcePath }) => path.relative(ROOT, sourcePath)),
  sourceBundleSha256: report.sourceBundleSha256,
  selectedCount: evaluations.length,
  qualifiedCount: qualifiedRows.length,
  proposedCount: codes.length,
  truncatedCount: qualifiedRows.length - approvedRows.length,
  rejectedCount: evaluations.length - qualifiedRows.length,
  minimumConfidence,
  minimumPublicationDate: minimumDate,
  maximumProposedCount,
  proposedCodes: codes,
  proposedRows: approvedRows,
  rejectionReasons: Object.fromEntries(
    Object.keys(evaluations[0]?.checks || {}).map(key => [
      key,
      evaluations.filter(row => !row.checks[key]).length,
    ]),
  ),
  identity: proposalIdentity,
});
console.log(JSON.stringify({
  outputPath: path.relative(ROOT, outputPath),
  candidatePath: path.relative(ROOT, candidatePath),
  sourceReportCount: sourceReports.length,
  proposalSha256,
  selectedCount: evaluations.length,
  qualifiedCount: qualifiedRows.length,
  proposedCount: codes.length,
  truncatedCount: qualifiedRows.length - approvedRows.length,
  rejectedCount: evaluations.length - qualifiedRows.length,
}, null, 2));
