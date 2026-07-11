import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const batchPath = process.env.GOVERNANCE_LEDGER_BATCH;
if (!batchPath) throw new Error('GOVERNANCE_LEDGER_BATCH is required');

const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const writeJson = (relativePath, value) => fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
const batch = readJson(batchPath);
const reviewPath = 'operations/reviews/decisions.json';
const correctionPath = 'operations/corrections/corrections.json';
const reviews = readJson(reviewPath);
const corrections = readJson(correctionPath);

if (batch.schemaVersion !== 'governance-ledger-batch-v1') throw new Error(`Unsupported schemaVersion: ${batch.schemaVersion}`);
if (!Array.isArray(batch.reviews) || !Array.isArray(batch.corrections)) throw new Error('reviews and corrections must be arrays');
if (batch.automaticApprovalAllowed !== false) throw new Error('automaticApprovalAllowed must be false');

const existingReviewIds = new Set(reviews.map(row => row.id));
const existingCorrectionIds = new Set(corrections.map(row => row.id));
const batchReviewIds = new Set();
const batchCorrectionIds = new Set();

for (const review of batch.reviews) {
  if (!/^review-[0-9A-Z]{4}-[0-9]{8}-[a-z0-9-]+$/.test(review.id || '')) throw new Error(`Invalid review id: ${review.id}`);
  if (existingReviewIds.has(review.id) || batchReviewIds.has(review.id)) throw new Error(`Duplicate review id: ${review.id}`);
  if (review.status === 'approved') throw new Error(`Batch cannot create approved review: ${review.id}`);
  if (!['pending', 'in_review', 'changes_requested', 'rejected'].includes(review.status)) throw new Error(`Invalid review status: ${review.id}:${review.status}`);
  if (review.reviewer && review.reviewer === review.author) throw new Error(`Reviewer must differ from author: ${review.id}`);
  batchReviewIds.add(review.id);
}

const allReviewIds = new Set([...existingReviewIds, ...batchReviewIds]);
for (const correction of batch.corrections) {
  if (!/^correction-[0-9A-Z]{4}-[0-9]{8}-[a-z0-9-]+$/.test(correction.id || '')) throw new Error(`Invalid correction id: ${correction.id}`);
  if (existingCorrectionIds.has(correction.id) || batchCorrectionIds.has(correction.id)) throw new Error(`Duplicate correction id: ${correction.id}`);
  if (!allReviewIds.has(correction.reviewDecisionId)) throw new Error(`Missing review reference: ${correction.id}:${correction.reviewDecisionId}`);
  if (correction.status !== 'corrected') throw new Error(`Batch correction must record applied change: ${correction.id}`);
  batchCorrectionIds.add(correction.id);
}

const reviewCodes = new Set(batch.reviews.map(row => String(row.companyCode)));
for (const correction of batch.corrections) {
  if (!reviewCodes.has(String(correction.companyCode))) throw new Error(`Correction company has no review in batch: ${correction.id}`);
}

writeJson(reviewPath, [...reviews, ...batch.reviews]);
writeJson(correctionPath, [...corrections, ...batch.corrections]);

const report = {
  version: 'governance-ledger-batch-v1',
  batchId: batch.batchId,
  appliedAt: new Date().toISOString(),
  reviewsAdded: batch.reviews.length,
  correctionsAdded: batch.corrections.length,
  totalReviews: reviews.length + batch.reviews.length,
  totalCorrections: corrections.length + batch.corrections.length,
  automaticApprovalAllowed: false,
};
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts', `${batch.batchId}-governance-report.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
