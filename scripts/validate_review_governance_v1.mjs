import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const REVIEW_PATH = path.join(ROOT, 'operations', 'reviews', 'decisions.json');
const CORRECTION_PATH = path.join(ROOT, 'operations', 'corrections', 'corrections.json');
const BUDGET_PATH = path.join(ROOT, 'operations', 'quality-debt-budget-v1.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const checks = [];
const issues = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) issues.push({ name, detail });
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return JSON.parse(zlib.gunzipSync(compressed));
}
function isIsoDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function allChecklistTrue(checklist) {
  const required = ['officialSource', 'publicationDate', 'pageEvidence', 'numbersUnitsYears', 'strategyClassification', 'comparisonDisplay', 'mobileDisplay'];
  return required.every(key => checklist?.[key] === true);
}

for (const schemaPath of ['schemas/review-decision-v1.schema.json', 'schemas/correction-entry-v1.schema.json']) {
  try {
    readJson(path.join(ROOT, schemaPath));
    check(`${schemaPath} readable`, true);
  } catch (error) {
    check(`${schemaPath} readable`, false, error.message);
  }
}

let data = { companies: [] };
let decisions = [];
let corrections = [];
let budget = { maximumCounts: {} };
try {
  data = readBundle();
  check('company bundle readable', true);
} catch (error) {
  check('company bundle readable', false, error.message);
}
try {
  decisions = readJson(REVIEW_PATH);
  check('review ledger readable', Array.isArray(decisions), `type=${typeof decisions}`);
} catch (error) {
  check('review ledger readable', false, error.message);
}
try {
  corrections = readJson(CORRECTION_PATH);
  check('correction ledger readable', Array.isArray(corrections), `type=${typeof corrections}`);
} catch (error) {
  check('correction ledger readable', false, error.message);
}
try {
  budget = readJson(BUDGET_PATH);
  check('quality debt budget readable', true);
} catch (error) {
  check('quality debt budget readable', false, error.message);
}

const companyCodes = new Set(data.companies.map(company => String(company.code)));
const decisionIds = new Set();
let invalidDecision = 0;
let invalidApproved = 0;
for (const decision of decisions) {
  const basic = /^review-[0-9A-Z]{4}-[0-9]{8}-[a-z0-9-]+$/.test(decision.id || '')
    && companyCodes.has(String(decision.companyCode))
    && ['detailed_extracted', 'source_indexed', 'jpx_indexed', 'core'].includes(decision.fromStage)
    && ['detailed_extracted', 'source_indexed', 'core'].includes(decision.targetStage)
    && ['pending', 'in_review', 'approved', 'changes_requested', 'rejected'].includes(decision.status)
    && typeof decision.author === 'string' && decision.author.trim()
    && typeof decision.sourceUrl === 'string' && decision.sourceUrl.startsWith('https://')
    && Array.isArray(decision.sourcePages)
    && isIsoDateTime(decision.createdAt);
  if (!basic || decisionIds.has(decision.id)) invalidDecision += 1;
  decisionIds.add(decision.id);
  if (decision.status === 'approved') {
    const approved = decision.targetStage === 'core'
      && allChecklistTrue(decision.checklist)
      && decision.sourcePages.length > 0
      && typeof decision.reviewer === 'string' && decision.reviewer.trim()
      && decision.reviewer !== decision.author
      && typeof decision.decisionReason === 'string' && decision.decisionReason.trim()
      && isIsoDateTime(decision.reviewedAt);
    if (!approved) invalidApproved += 1;
  }
}
check('review decision records valid', invalidDecision === 0, `invalid=${invalidDecision}`);
check('approved decisions satisfy double-check gate', invalidApproved === 0, `invalid-approved=${invalidApproved}`);

const correctionIds = new Set();
let invalidCorrection = 0;
let invalidCorrected = 0;
for (const correction of corrections) {
  const basic = /^correction-[0-9A-Z]{4}-[0-9]{8}-[a-z0-9-]+$/.test(correction.id || '')
    && companyCodes.has(String(correction.companyCode))
    && typeof correction.fieldPath === 'string' && correction.fieldPath.trim()
    && typeof correction.reason === 'string' && correction.reason.trim()
    && typeof correction.sourceUrl === 'string' && correction.sourceUrl.startsWith('https://')
    && ['open', 'confirmed', 'corrected', 'rejected'].includes(correction.status)
    && isIsoDateTime(correction.detectedAt);
  if (!basic || correctionIds.has(correction.id)) invalidCorrection += 1;
  correctionIds.add(correction.id);
  if (correction.status === 'corrected') {
    const linked = correction.reviewDecisionId && decisionIds.has(correction.reviewDecisionId);
    if (!linked || correction.after === undefined || !isIsoDateTime(correction.correctedAt)) invalidCorrected += 1;
  }
}
check('correction records valid', invalidCorrection === 0, `invalid=${invalidCorrection}`);
check('corrected entries link to review decision', invalidCorrected === 0, `invalid-corrected=${invalidCorrected}`);

const pageEvidence = company => (company.evidenceRefs || []).some(ref => /(?:p\.?\s*\d|ページ\s*\d)/i.test(String(ref)));
const detailed = data.companies.filter(company => company.stage === 'detailed_extracted');
const priorityA = detailed.filter(pageEvidence).length;
const priorityB = detailed.filter(company => !pageEvidence(company)).length;
const detailedGapMaximum = budget.maximumCounts?.['detailed.missingPageEvidence'];
check('review queue source has 70 companies', detailed.length === 70, `actual=${detailed.length}`);
check('review queue priorities partition all detailed companies', priorityA + priorityB === detailed.length, `A=${priorityA}, B=${priorityB}, total=${detailed.length}`);
check('priority B is within quality debt budget', Number.isInteger(detailedGapMaximum) && priorityB <= detailedGapMaximum, `actual=${priorityB}, maximum=${detailedGapMaximum}`);
check('priority A matches evidence improvement', priorityA >= detailed.length - detailedGapMaximum, `actual=${priorityA}, minimum=${detailed.length - detailedGapMaximum}`);
check('no automatic promotion records', decisions.every(decision => decision.status !== 'approved' || decision.reviewer !== 'automation'), 'automation cannot approve production promotion');

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const report = {
  version: 'review-governance-v1',
  checkedAt: new Date().toISOString(),
  summary: {
    reviewDecisions: decisions.length,
    corrections: corrections.length,
    priorityA,
    priorityB,
    detailedPageEvidenceDebtMaximum: detailedGapMaximum,
  },
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  checks,
  issues,
};
fs.writeFileSync(path.join(ARTIFACT_DIR, 'review-governance-report-v1.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
