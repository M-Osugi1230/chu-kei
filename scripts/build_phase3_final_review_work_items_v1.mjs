import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const QUEUE = 'operations/quality-rebase/phase3/generated/final-review-queue-v1.json';
const OUTPUT_DIR = 'operations/quality-rebase/phase3/generated/final-review-work-items';
const BATCH_SIZE = 10;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const queue = readJson(QUEUE);
const ready = queue.readyForSeparateFinalReview ?? [];

assert(queue.schemaVersion === 'quality-rebase-phase3-final-review-queue-v1', 'Unexpected Phase 3 final-review queue schema.');
assert(ready.every(row => row.blockerCount === 0), 'Blocked company leaked into ready final-review queue.');

const outputDir = path.join(ROOT, OUTPUT_DIR);
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const batches = [];
for (let offset = 0, batchNumber = 1; offset < ready.length; offset += BATCH_SIZE, batchNumber += 1) {
  const rows = ready.slice(offset, offset + BATCH_SIZE);
  const file = `batch-${String(batchNumber).padStart(2, '0')}.json`;
  const items = rows.map(row => ({
    company: {
      code: row.code,
      name: row.name,
    },
    priority: row.priority,
    evidence: {
      primaryReviewFile: row.primaryReviewFile,
      independentCompletionFile: row.completionFile,
      independentReviewPacket: row.independentReviewPacket,
      sourceCorrectionFile: row.sourceCorrectionFile,
      sourceResolutionFile: row.sourceResolutionFile,
    },
    requiredChecks: [
      'reviewer_independence',
      'source_identity_and_latest_correction_boundary',
      'formal_plan_or_document_classification_boundary',
      'financial_targets_actual_forecast_plan_separation',
      'year_unit_scope_and_table_header_recheck',
      'strategy_structure_recheck',
      'capital_allocation_and_shareholder_return_recheck',
      'evidence_page_or_heading_traceability',
      'remaining_blocker_recheck',
      'production_link_and_render_check_when_required',
    ],
    decision: {
      status: 'pending_final_reviewer',
      reviewerRole: 'final_reviewer',
      reviewerIdentity: null,
      reviewedAt: null,
      deepVerificationApproved: false,
      approvalReason: null,
      rejectionOrFollowupReason: null,
    },
    safeguards: {
      primaryReviewerMaySelfApprove: false,
      independentReviewerMaySelfApproveFinalGate: false,
      automaticFactCompletionAllowed: false,
      automaticApprovalAllowed: false,
      automaticProductionPromotionAllowed: false,
    },
  }));

  const payload = {
    schemaVersion: 'quality-rebase-phase3-final-review-work-items-v1',
    batch: batchNumber,
    batchSize: items.length,
    totalReadyCompanies: ready.length,
    status: 'pending_separate_final_reviewer',
    items,
  };

  fs.writeFileSync(path.join(outputDir, file), `${JSON.stringify(payload, null, 2)}\n`);
  batches.push({
    batch: batchNumber,
    file: `${OUTPUT_DIR}/${file}`,
    count: items.length,
    firstCode: items[0]?.company.code ?? null,
    lastCode: items.at(-1)?.company.code ?? null,
  });
}

const index = {
  schemaVersion: 'quality-rebase-phase3-final-review-work-item-index-v1',
  queueFile: QUEUE,
  batchSize: BATCH_SIZE,
  readyCompanies: ready.length,
  batchCount: batches.length,
  batches,
  policy: {
    generatedItemsAreNotApprovals: true,
    separateFinalReviewerRequired: true,
    automaticFactCompletionAllowed: false,
    automaticApprovalAllowed: false,
    automaticProductionPromotionAllowed: false,
  },
};

fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

console.log(JSON.stringify({
  outputDir: OUTPUT_DIR,
  readyCompanies: ready.length,
  batchCount: batches.length,
  batches,
}, null, 2));
