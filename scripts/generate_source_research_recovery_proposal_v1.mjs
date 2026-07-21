import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const CONFIG_PATH = path.resolve(
  process.env.SOURCE_RESEARCH_RECOVERY_PROPOSAL_CONFIG
    || 'operations/source-research/source-research-recovery-proposal-config.json',
);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))),
  );
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error('Bundle SHA-256 mismatch');
  return { manifest, bundle: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
}

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'source-research-recovery-proposal-config-v1') {
  throw new Error(`Unsupported recovery proposal config: ${config.schemaVersion}`);
}
if (!Array.isArray(config.candidatePaths) || !config.candidatePaths.length) {
  throw new Error('candidatePaths is required');
}
if (!config.outputCandidatePath || !config.outputProposalPath || !config.recoveryId) {
  throw new Error('outputCandidatePath, outputProposalPath and recoveryId are required');
}

const minimumConfidence = Number(config.minimumConfidence || 85);
const minimumDate = String(config.minimumPublicationDate || '2022-01-01');
const maximumProposedCount = Number(config.maximumProposedCount || 21);
if (!Number.isInteger(maximumProposedCount) || maximumProposedCount <= 0) {
  throw new Error(`Invalid maximumProposedCount: ${config.maximumProposedCount}`);
}
const allowedOriginalStatuses = new Set(config.allowedOriginalStatuses || ['eligible', 'needs_review']);
const allowedDocumentPatternText = config.allowedDocumentPattern
  || '中期|中長期|長期経営|事業計画|経営計画|経営戦略|成長戦略|経営方針|決算説明|決算補足|決算短信|統合報告';
const allowedDocumentPattern = new RegExp(allowedDocumentPatternText);
const { manifest, bundle } = readBundle();
const currentStages = new Map(bundle.companies.map(company => [String(company.code), company.stage]));

const evaluated = [];
for (const candidatePathValue of config.candidatePaths) {
  const candidatePath = path.resolve(candidatePathValue);
  const report = readJson(candidatePath);
  if (report.schemaVersion !== 'source-research-candidates-v1') {
    throw new Error(`Unsupported candidate report: ${report.schemaVersion}`);
  }
  for (const candidate of report.results || []) {
    const code = String(candidate.code);
    const record = candidate.record || {};
    const document = candidate.document || {};
    const evidenceRefs = [...new Set(record.evidenceRefs || [])]
      .filter(ref => /公式PDF p\.\d+/.test(String(ref)));
    const themes = [...new Set(record.themes || [])];
    const checks = {
      currentStage: currentStages.get(code) === 'jpx_indexed',
      allowedOriginalStatus: allowedOriginalStatuses.has(candidate.status),
      officialJpxPdf: /^https:\/\/www2\.jpx\.co\.jp\/disc\//.test(document.url || record.sourceUrl || ''),
      identityMatch: candidate.identityMatch === true,
      confidence: Number(candidate.confidence || 0) >= minimumConfidence,
      publicationDate: Boolean(document.date && document.date >= minimumDate),
      documentType: allowedDocumentPattern.test(String(document.title || '')),
      pageEvidence: evidenceRefs.length >= 2,
      pageCount: Number(candidate.pageCount || 0) >= 2,
      themes: themes.length >= 2,
      structuredSummary: typeof record.summary === 'string' && record.summary.length >= 20,
      progressGuard: record.progressAssessment?.status !== 'connected',
    };
    const approvedByHardChecks = Object.values(checks).every(Boolean);
    evaluated.push({
      code,
      candidate,
      candidatePath: path.relative(ROOT, candidatePath),
      evidenceCount: evidenceRefs.length,
      themeCount: themes.length,
      documentDate: document.date || '',
      checks,
      approvedByHardChecks,
    });
  }
}

const bestByCode = new Map();
for (const row of evaluated.filter(item => item.approvedByHardChecks)) {
  const current = bestByCode.get(row.code);
  const score = Number(row.candidate.confidence || 0) * 10000
    + row.evidenceCount * 100
    + row.themeCount * 10
    + Number(String(row.documentDate).replaceAll('-', '') || 0) / 100000000;
  if (!current || score > current.score) bestByCode.set(row.code, { ...row, score });
}

const qualified = [...bestByCode.values()].sort((a, b) =>
  Number(b.candidate.confidence || 0) - Number(a.candidate.confidence || 0)
  || b.evidenceCount - a.evidenceCount
  || b.themeCount - a.themeCount
  || b.documentDate.localeCompare(a.documentDate)
  || a.code.localeCompare(b.code, 'ja'));
const selected = qualified.slice(0, maximumProposedCount);
const selectedCodes = selected.map(row => row.code).sort((a, b) => a.localeCompare(b, 'ja'));
const selectedByCode = new Map(selected.map(row => [row.code, row]));
const outputCandidatePath = path.resolve(config.outputCandidatePath);
const recoveryResults = selectedCodes.map(code => {
  const row = selectedByCode.get(code);
  return {
    ...row.candidate,
    recoveryReview: {
      schemaVersion: 'source-research-recovery-review-v1',
      recoveryId: config.recoveryId,
      originalStatus: row.candidate.status,
      originalConfidence: row.candidate.confidence ?? null,
      sourceCandidatePath: row.candidatePath,
      approvedByHardChecks: true,
      checks: row.checks,
      automaticApproval: false,
      explicitApprovalRequired: true,
    },
  };
});
writeJson(outputCandidatePath, {
  schemaVersion: 'source-research-candidates-v1',
  batchId: config.recoveryId,
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: manifest.sha256,
  automaticFactCompletion: false,
  automaticApproval: false,
  selectedCount: recoveryResults.length,
  eligibleCount: recoveryResults.filter(row => row.status === 'eligible').length,
  needsReviewCount: recoveryResults.filter(row => row.status === 'needs_review').length,
  failureCount: 0,
  selectedCodes,
  results: recoveryResults,
  recoveryPolicy: {
    minimumConfidence,
    minimumPublicationDate: minimumDate,
    maximumProposedCount,
    allowedOriginalStatuses: [...allowedOriginalStatuses],
    allowedDocumentPattern: allowedDocumentPatternText,
    requireCurrentStage: 'jpx_indexed',
    requireOfficialJpxPdf: true,
    requireIdentityMatch: true,
    requirePageEvidenceCount: 2,
    requirePageCount: 2,
    requireThemeCount: 2,
    automaticApproval: false,
  },
});

const proposalIdentity = {
  schemaVersion: 'source-research-bulk-proposal-identity-v1',
  batchId: config.recoveryId,
  sourceBundleSha256: manifest.sha256,
  candidatePath: path.relative(ROOT, outputCandidatePath),
  recoveryMode: 'explicit-near-miss-review-v1',
  minimumConfidence,
  minimumPublicationDate: minimumDate,
  maximumProposedCount,
  allowedOriginalStatuses: [...allowedOriginalStatuses].sort(),
  allowedDocumentPattern: allowedDocumentPatternText,
  codes: selectedCodes,
};
const proposalSha256 = sha256(proposalIdentity);
const outputProposalPath = path.resolve(config.outputProposalPath);
writeJson(outputProposalPath, {
  schemaVersion: 'source-research-bulk-proposal-v1',
  generatedAt: new Date().toISOString(),
  proposalSha256,
  automaticApproval: false,
  automaticProductionPromotion: false,
  recoveryMode: 'explicit-near-miss-review-v1',
  candidatePath: path.relative(ROOT, outputCandidatePath),
  sourceBundleSha256: manifest.sha256,
  selectedCount: evaluated.length,
  qualifiedCount: qualified.length,
  proposedCount: selectedCodes.length,
  truncatedCount: Math.max(0, qualified.length - selectedCodes.length),
  rejectedCount: evaluated.filter(row => !row.approvedByHardChecks).length,
  minimumConfidence,
  minimumPublicationDate: minimumDate,
  maximumProposedCount,
  allowedOriginalStatuses: [...allowedOriginalStatuses].sort(),
  allowedDocumentPattern: allowedDocumentPatternText,
  proposedCodes: selectedCodes,
  proposedRows: selectedCodes.map(code => {
    const row = selectedByCode.get(code);
    return {
      code,
      name: row.candidate.name,
      originalStatus: row.candidate.status,
      confidence: row.candidate.confidence ?? null,
      documentDate: row.candidate.document?.date || null,
      documentTitle: row.candidate.document?.title || null,
      documentUrl: row.candidate.document?.url || row.candidate.record?.sourceUrl || null,
      sourceCandidatePath: row.candidatePath,
      checks: row.checks,
      approvedByHardChecks: true,
    };
  }),
  rejectionReasons: Object.fromEntries(
    Object.keys(evaluated[0]?.checks || {}).map(key => [
      key,
      evaluated.filter(row => !row.checks[key]).length,
    ]),
  ),
  identity: proposalIdentity,
});

console.log(JSON.stringify({
  recoveryId: config.recoveryId,
  evaluatedCount: evaluated.length,
  qualifiedCount: qualified.length,
  proposedCount: selectedCodes.length,
  outputCandidatePath: path.relative(ROOT, outputCandidatePath),
  outputProposalPath: path.relative(ROOT, outputProposalPath),
  proposalSha256,
}, null, 2));
