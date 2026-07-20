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
const candidatePath = path.resolve(config.candidatePath);
const report = readJson(candidatePath);
if (report.schemaVersion !== 'source-research-candidates-v1') {
  throw new Error(`Unsupported candidate report: ${report.schemaVersion}`);
}

const minimumConfidence = Number(config.minimumConfidence || 93);
const minimumDate = String(config.minimumPublicationDate || '2024-01-01');
const allowedStatuses = new Set(config.allowedStatuses || ['eligible']);
const allowedDocumentPattern = new RegExp(
  config.allowedDocumentPattern
    || '中期|中長期|長期経営|事業計画|経営計画|経営戦略|成長戦略|経営方針|決算説明|決算補足|決算短信|統合報告',
);

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

const approvedRows = evaluations.filter(row => row.approvedByRules);
const codes = approvedRows.map(row => row.code).sort((a, b) => a.localeCompare(b, 'ja'));
const proposalIdentity = {
  schemaVersion: 'source-research-bulk-proposal-identity-v1',
  batchId: report.batchId,
  sourceBundleSha256: report.sourceBundleSha256,
  candidatePath: path.relative(ROOT, candidatePath),
  minimumConfidence,
  minimumPublicationDate: minimumDate,
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
  sourceBundleSha256: report.sourceBundleSha256,
  selectedCount: evaluations.length,
  proposedCount: codes.length,
  rejectedCount: evaluations.length - codes.length,
  minimumConfidence,
  minimumPublicationDate: minimumDate,
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
  proposalSha256,
  selectedCount: evaluations.length,
  proposedCount: codes.length,
  rejectedCount: evaluations.length - codes.length,
}, null, 2));
