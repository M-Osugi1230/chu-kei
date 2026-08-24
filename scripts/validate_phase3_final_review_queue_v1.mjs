import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const QUEUE = 'operations/quality-rebase/phase3/generated/final-review-queue-v1.json';
const STATUS = 'operations/quality-rebase/phase3/status-v1.json';
const INDEPENDENT_STATUS = 'operations/quality-rebase/phase2/independent-review-status-v1.json';
const DEEP_STATUS = 'operations/quality-rebase/phase2/deep-verification-status-v1.json';
const EFFECTIVE_STATUS = 'operations/quality-rebase/phase2/effective-status-v1.json';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const queue = readJson(QUEUE);
const status = readJson(STATUS);
const independentStatus = readJson(INDEPENDENT_STATUS);
const deepStatus = readJson(DEEP_STATUS);
const effectiveStatus = readJson(EFFECTIVE_STATUS);

assert(queue.schemaVersion === 'quality-rebase-phase3-final-review-queue-v1', 'Unexpected Phase 3 queue schema.');
assert(status.schemaVersion === 'quality-rebase-phase3-status-v1', 'Unexpected Phase 3 status schema.');
assert(effectiveStatus.review?.phase2PrimaryReviewComplete === 450, 'Phase 2 primary review must remain 450/450.');
assert(effectiveStatus.review?.remainingPhase2PrimaryReviews === 0, 'Phase 2 remaining primary reviews must be zero.');
assert(effectiveStatus.review?.primaryReviewCompleteIncludingPhase1 === 500, 'Phase 1 + Phase 2 primary review must remain 500/500.');

const ready = queue.readyForSeparateFinalReview ?? [];
const blocked = queue.blockedBeforeFinalReview ?? [];
const all = [...ready, ...blocked];
const codes = all.map(row => String(row.code));

assert(new Set(codes).size === codes.length, 'Phase 3 queue contains duplicate company codes.');
assert(all.length === independentStatus.counts?.independentReviewComplete, 'Phase 3 queue does not cover every independent completion.');
assert(ready.length === deepStatus.counts?.readyForSeparateFinalReview, 'Ready count differs from Deep Verification status.');
assert(blocked.length === deepStatus.counts?.companiesWithExplicitFinalBlockers, 'Blocked count differs from Deep Verification status.');
assert(queue.counts?.deepVerificationApproved === 0, 'Generated queue must not contain automatic Deep Verification approvals.');
assert(status.phase2Handoff?.deepVerificationApproved === 0, 'Phase 3 status must not pre-approve Deep Verification.');
assert(deepStatus.counts?.deepVerificationApproved === 0, 'Deep Verification status must remain unapproved before final review.');

for (const row of ready) {
  assert(row.blockerCount === 0, `Ready row has blockers: ${row.code}`);
  assert(Array.isArray(row.blockers) && row.blockers.length === 0, `Ready row blocker list is not empty: ${row.code}`);
  assert(row.finalReviewStatus === 'pending_separate_final_reviewer', `Unexpected ready status: ${row.code}`);
  assert(row.requiredReviewRole === 'final_reviewer', `Final reviewer role missing: ${row.code}`);
  assert(row.selfApprovalAllowed === false, `Self approval must be false: ${row.code}`);
  assert(row.automaticApprovalAllowed === false, `Automatic approval must be false: ${row.code}`);
  assert(row.deepVerificationApproved === false, `Ready row may not be pre-approved: ${row.code}`);
}

for (const row of blocked) {
  assert(row.blockerCount > 0, `Blocked row has no blockers: ${row.code}`);
  assert(Array.isArray(row.blockers) && row.blockers.length === row.blockerCount, `Blocked row blocker count mismatch: ${row.code}`);
  assert(row.finalReviewStatus === 'blocked_before_final_review', `Unexpected blocked status: ${row.code}`);
  assert(row.deepVerificationApproved === false, `Blocked row may not be approved: ${row.code}`);
}

const deepBlocked = new Map((deepStatus.blockedCompanies ?? []).map(row => [String(row.code), [...(row.blockers ?? [])].sort()]));
for (const row of blocked) {
  const expected = deepBlocked.get(String(row.code));
  assert(expected, `Blocked row absent from Deep Verification status: ${row.code}`);
  assert(JSON.stringify([...row.blockers].sort()) === JSON.stringify(expected), `Blocker list differs for ${row.code}`);
}

assert(queue.policy?.companyCodeIsCountingUnit === true, 'Company code must remain the counting unit.');
assert(queue.policy?.absenceOfExplicitBlockerDoesNotEqualApproval === true, 'Absence of blockers must not equal approval.');
assert(queue.policy?.finalReviewerMustBeSeparateRole === true, 'Separate final reviewer role must be required.');
assert(queue.policy?.primaryReviewerMaySelfApprove === false, 'Primary reviewer self approval must remain disabled.');
assert(queue.policy?.independentReviewerMaySelfApproveFinalGate === false, 'Independent reviewer self approval must remain disabled.');
assert(queue.policy?.automaticApprovalAllowed === false, 'Automatic approval must remain disabled.');
assert(queue.policy?.automaticProductionPromotionAllowed === false, 'Automatic production promotion must remain disabled.');

assert(status.productionObservation?.alignmentStatus === 'production_behind_repository_quality_state', 'Production/repository alignment drift must stay explicit until reverified.');
assert(status.company421A?.remainingBlockers?.includes('post_publication_link_and_render_check'), '421A public post-publication blocker must remain explicit until verified.');

console.log(JSON.stringify({
  phase2PrimaryReviewComplete: effectiveStatus.review.phase2PrimaryReviewComplete,
  primaryReviewCompleteIncludingPhase1: effectiveStatus.review.primaryReviewCompleteIncludingPhase1,
  independentReviewComplete: all.length,
  readyForSeparateFinalReview: ready.length,
  blockedBeforeFinalReview: blocked.length,
  blockedCodes: blocked.map(row => row.code),
  productionAlignmentStatus: status.productionObservation.alignmentStatus,
  deepVerificationApproved: 0,
}, null, 2));
