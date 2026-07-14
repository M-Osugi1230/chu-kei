import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const batchPath = process.env.PRODUCTION_APPROVAL_LEDGER;
if (!batchPath) throw new Error('PRODUCTION_APPROVAL_LEDGER is required');

const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const writeJson = (relativePath, value) => fs.writeFileSync(path.join(ROOT, relativePath), `${JSON.stringify(value, null, 2)}\n`);
const sameRecord = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const allChecklistTrue = checklist => [
  'officialSource',
  'publicationDate',
  'pageEvidence',
  'numbersUnitsYears',
  'strategyClassification',
  'comparisonDisplay',
  'mobileDisplay',
].every(key => checklist?.[key] === true);

const batch = readJson(batchPath);
const reviewPath = 'operations/reviews/decisions.json';
const correctionPath = 'operations/corrections/corrections.json';
const reviews = readJson(reviewPath);
const corrections = readJson(correctionPath);

if (batch.schemaVersion !== 'governance-ledger-batch-v1') throw new Error(`Unsupported schemaVersion: ${batch.schemaVersion}`);
if (batch.automaticApprovalAllowed !== false) throw new Error('automaticApprovalAllowed must be false');
if (batch.explicitProductionApproval !== true) throw new Error('explicitProductionApproval must be true');
if (!Array.isArray(batch.reviews) || !Array.isArray(batch.corrections)) throw new Error('reviews and corrections must be arrays');

const reviewsByCode = new Map();
for (const review of batch.reviews) {
  if (!/^review-[0-9A-Z]{4}-[0-9]{8}-[a-z0-9-]+$/.test(review.id || '')) throw new Error(`Invalid review id: ${review.id}`);
  if (review.status !== 'approved' || review.targetStage !== 'core') throw new Error(`Production review must approve core: ${review.id}`);
  if (!allChecklistTrue(review.checklist)) throw new Error(`Production review checklist incomplete: ${review.id}`);
  if (!review.author || !review.reviewer || review.author === review.reviewer) throw new Error(`Production reviewer must differ from author: ${review.id}`);
  if (!Array.isArray(review.sourcePages) || review.sourcePages.length < 2) throw new Error(`Production review requires at least two evidence refs: ${review.id}`);
  if (!review.sourceUrl?.startsWith('https://')) throw new Error(`Production review source must be HTTPS: ${review.id}`);
  if (Number.isNaN(Date.parse(review.createdAt)) || Number.isNaN(Date.parse(review.reviewedAt))) throw new Error(`Production review dates invalid: ${review.id}`);
  const code = String(review.companyCode);
  const rows = reviewsByCode.get(code) || [];
  rows.push(review);
  reviewsByCode.set(code, rows);
}
for (const [code, rows] of reviewsByCode) {
  const reviewers = new Set(rows.map(row => row.reviewer));
  if (rows.length < 2 || reviewers.size < 2) throw new Error(`Two independent approvals are required for ${code}`);
}

const existingReviews = new Map(reviews.map(row => [row.id, row]));
const existingCorrections = new Map(corrections.map(row => [row.id, row]));
const reviewsToAdd = [];
const correctionsToAdd = [];
for (const review of batch.reviews) {
  const existing = existingReviews.get(review.id);
  if (existing && !sameRecord(existing, review)) throw new Error(`Conflicting existing review: ${review.id}`);
  if (!existing) reviewsToAdd.push(review);
}
const allReviewIds = new Set([...existingReviews.keys(), ...batch.reviews.map(row => row.id)]);
for (const correction of batch.corrections) {
  if (!/^correction-[0-9A-Z]{4}-[0-9]{8}-[a-z0-9-]+$/.test(correction.id || '')) throw new Error(`Invalid correction id: ${correction.id}`);
  if (correction.status !== 'corrected' || !allReviewIds.has(correction.reviewDecisionId)) throw new Error(`Invalid production correction: ${correction.id}`);
  const existing = existingCorrections.get(correction.id);
  if (existing && !sameRecord(existing, correction)) throw new Error(`Conflicting existing correction: ${correction.id}`);
  if (!existing) correctionsToAdd.push(correction);
}

writeJson(reviewPath, [...reviews, ...reviewsToAdd]);
writeJson(correctionPath, [...corrections, ...correctionsToAdd]);
const report = {
  version: 'production-approval-ledger-apply-v1',
  batchId: batch.batchId,
  companyApprovals: reviewsByCode.size,
  reviewsAdded: reviewsToAdd.length,
  correctionsAdded: correctionsToAdd.length,
  explicitProductionApproval: true,
  automaticApprovalUsed: false,
};
fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts', `${batch.batchId}-approval-report.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
