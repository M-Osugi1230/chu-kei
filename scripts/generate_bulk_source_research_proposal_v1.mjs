import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
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

function readCurrentBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))),
  );
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error('Bundle SHA-256 mismatch');
  return {
    manifest,
    bundle: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')),
  };
}

function candidateRank(candidate) {
  const statusScore = {
    eligible: 4,
    needs_review: 3,
    pdf_text_insufficient: 2,
    error: 1,
  }[String(candidate.status || '')] || 0;
  const documentDate = String(candidate.document?.date || '').replace(/-/g, '');
  const evidenceCount = (candidate.record?.evidenceRefs || [])
    .filter(ref => /公式PDF p\.\d+/.test(String(ref))).length;
  return [
    statusScore,
    candidate.identityMatch === true ? 1 : 0,
    Number(candidate.confidence || 0),
    Number(documentDate || 0),
    Number(candidate.pageCount || 0),
    evidenceCount,
  ];
}

function isBetterCandidate(next, current) {
  const nextRank = candidateRank(next);
  const currentRank = candidateRank(current);
  for (let index = 0; index < nextRank.length; index += 1) {
    if (nextRank[index] !== currentRank[index]) return nextRank[index] > currentRank[index];
  }
  return false;
}

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

const { manifest: currentManifest, bundle: currentBundle } = readCurrentBundle();
const currentStageByCode = new Map(
  (currentBundle.companies || []).map(company => [String(company.code), String(company.stage || '')]),
);
const requiredCurrentStage = config.requiredCurrentStage == null
  ? null
  : String(config.requiredCurrentStage);

const resultByCode = new Map();
const duplicateCodes = new Set();
const candidateOrigins = new Map();
for (const { report, candidatePath } of sourceReports) {
  const relativeCandidatePath = path.relative(ROOT, candidatePath);
  for (const candidate of report.results || []) {
    const code = String(candidate.code);
    const origins = candidateOrigins.get(code) || [];
    origins.push(relativeCandidatePath);
    candidateOrigins.set(code, origins);
    const current = resultByCode.get(code);
    if (current) {
      duplicateCodes.add(code);
      if (isBetterCandidate(candidate, current)) resultByCode.set(code, candidate);
    } else {
      resultByCode.set(code, candidate);
    }
  }
  if ((report.results || []).length !== Number(report.selectedCount || 0)) {
    throw new Error(`Candidate selectedCount mismatch: ${relativeCandidatePath}`);
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
  const results = [...resultByCode.values()]
    .sort((left, right) => String(left.code).localeCompare(String(right.code), 'ja'));
  report = {
    schemaVersion: 'source-research-candidates-v1',
    batchId: aggregateBatchId,
    generatedAt: new Date().toISOString(),
    sourceBundleSha256: currentManifest.sha256,
    sourceReportBundleSha256s: [...new Set(sourceReports.map(({ report: sourceReport }) => sourceReport.sourceBundleSha256))],
    automaticFactCompletion: false,
    automaticApproval: false,
    selectedCount: results.length,
    eligibleCount: results.filter(candidate => candidate.status === 'eligible').length,
    needsReviewCount: results.filter(candidate => candidate.status === 'needs_review').length,
    failureCount: results.filter(candidate => !['eligible', 'needs_review'].includes(candidate.status)).length,
    duplicateCodeCount: duplicateCodes.size,
    duplicateCodes: [...duplicateCodes].sort((left, right) => left.localeCompare(right, 'ja')),
    selectedCodes: results.map(candidate => String(candidate.code)),
    eligibleCodes: results.filter(candidate => candidate.status === 'eligible').map(candidate => String(candidate.code)),
    sourceReports: sourceReports.map(({ candidatePath: sourcePath, report: sourceReport }) => ({
      path: path.relative(ROOT, sourcePath),
      batchId: sourceReport.batchId,
      selectedCount: sourceReport.selectedCount,
      sourceBundleSha256: sourceReport.sourceBundleSha256,
    })),
    candidateOrigins: Object.fromEntries(
      [...candidateOrigins.entries()]
        .filter(([, origins]) => origins.length > 1)
        .sort(([left], [right]) => left.localeCompare(right, 'ja')),
    ),
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
  const code = String(candidate.code);
  const record = candidate.record || {};
  const document = candidate.document || {};
  const evidenceRefs = record.evidenceRefs || [];
  const currentStage = currentStageByCode.get(code) || null;
  const checks = {
    currentStage: requiredCurrentStage == null || currentStage === requiredCurrentStage,
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
    code,
    name: candidate.name,
    currentStage,
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
  sourceBundleSha256: currentManifest.sha256,
  candidatePath: path.relative(ROOT, candidatePath),
  requiredCurrentStage,
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
  sourceBundleSha256: currentManifest.sha256,
  requiredCurrentStage,
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
  duplicateCodeCount: duplicateCodes.size,
  currentBundleSha256: currentManifest.sha256,
  requiredCurrentStage,
  proposalSha256,
  selectedCount: evaluations.length,
  qualifiedCount: qualifiedRows.length,
  proposedCount: codes.length,
  truncatedCount: qualifiedRows.length - approvedRows.length,
  rejectedCount: evaluations.length - qualifiedRows.length,
}, null, 2));
