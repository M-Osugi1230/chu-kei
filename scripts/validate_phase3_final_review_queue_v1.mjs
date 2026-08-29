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

const pending = queue.readyForSeparateFinalReview ?? [];
const approved = queue.approvedBySeparateFinalReview ?? [];
const deferred = queue.deferredAfterFinalReview ?? [];
const blocked = queue.blockedBeforeFinalReview ?? [];
const all = [...pending, ...approved, ...deferred, ...blocked];
const codes = all.map(row => String(row.code));

assert(new Set(codes).size === codes.length, 'Phase 3 queue contains duplicate company codes.');
assert(all.length === independentStatus.counts?.independentReviewComplete, 'Phase 3 queue does not cover every independent completion.');
assert(blocked.length === deepStatus.counts?.companiesWithExplicitFinalBlockers, 'Blocked count differs from Phase 2 Deep Verification handoff.');
assert(queue.counts?.initialReadyForSeparateFinalReview === deepStatus.counts?.readyForSeparateFinalReview, 'Initial ready count differs from Phase 2 Deep Verification handoff.');
assert(pending.length + approved.length + deferred.length === queue.counts?.initialReadyForSeparateFinalReview, 'Final-review states do not conserve the initial ready population.');
assert(queue.counts?.pendingSeparateFinalReview === pending.length, 'Pending count mismatch.');
assert(queue.counts?.approvedBySeparateFinalReview === approved.length, 'Approved count mismatch.');
assert(queue.counts?.deferredAfterFinalReview === deferred.length, 'Deferred count mismatch.');
assert(queue.counts?.finalReviewCompleted === approved.length + deferred.length, 'Completed final-review count mismatch.');
assert(queue.counts?.companiesWithExplicitFinalBlockers === blocked.length, 'Explicit blocker count mismatch.');
assert(queue.counts?.deepVerificationApproved === approved.length, 'Deep Verification approved count must come only from approved final-review records.');
assert(status.phase2Handoff?.deepVerificationApproved === 0, 'Phase 2 handoff must remain an unapproved historical handoff.');

for (const row of pending) {
  assert(row.blockerCount === 0, `Pending row has blockers: ${row.code}`);
  assert(row.finalReviewStatus === 'pending_separate_final_reviewer', `Unexpected pending status: ${row.code}`);
  assert(row.requiredReviewRole === 'final_reviewer', `Final reviewer role missing: ${row.code}`);
  assert(row.selfApprovalAllowed === false, `Self approval must be false: ${row.code}`);
  assert(row.automaticApprovalAllowed === false, `Automatic approval must be false: ${row.code}`);
  assert(row.deepVerificationApproved === false, `Pending row may not be approved: ${row.code}`);
}

for (const row of approved) {
  assert(row.blockerCount === 0, `Approved row has blockers: ${row.code}`);
  assert(row.finalReviewStatus === 'approved_by_separate_final_reviewer', `Unexpected approved status: ${row.code}`);
  assert(typeof row.finalReviewFile === 'string' && row.finalReviewFile.length > 0, `Approved row is missing an audit record: ${row.code}`);
  assert(row.requiredReviewRole === 'final_reviewer', `Approved row is missing final reviewer role: ${row.code}`);
  assert(row.selfApprovalAllowed === false, `Approved row may not allow self approval: ${row.code}`);
  assert(row.automaticApprovalAllowed === false, `Approved row may not allow automatic approval: ${row.code}`);
  assert(row.deepVerificationApproved === true, `Approved row must explicitly approve Deep Verification: ${row.code}`);
}

for (const row of deferred) {
  assert(row.blockerCount === 0, `Deferred row unexpectedly has a pre-review blocker: ${row.code}`);
  assert(row.finalReviewStatus === 'deferred_after_final_review', `Unexpected deferred status: ${row.code}`);
  assert(typeof row.finalReviewFile === 'string' && row.finalReviewFile.length > 0, `Deferred row is missing an audit record: ${row.code}`);
  assert(row.deepVerificationApproved === false, `Deferred row may not approve Deep Verification: ${row.code}`);
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
  assert(expected, `Blocked row absent from Phase 2 Deep Verification handoff: ${row.code}`);
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
if (blocked.some(row => String(row.code) === '421A')) {
  assert(status.company421A?.remainingBlockers?.includes('post_publication_link_and_render_check'), '421A public post-publication blocker must remain explicit while 421A is blocked.');
}

console.log(JSON.stringify({
  phase2PrimaryReviewComplete: effectiveStatus.review.phase2PrimaryReviewComplete,
  primaryReviewCompleteIncludingPhase1: effectiveStatus.review.primaryReviewCompleteIncludingPhase1,
  independentReviewComplete: all.length,
  initialReadyForSeparateFinalReview: queue.counts.initialReadyForSeparateFinalReview,
  pendingSeparateFinalReview: pending.length,
  approvedBySeparateFinalReview: approved.length,
  deferredAfterFinalReview: deferred.length,
  blockedBeforeFinalReview: blocked.length,
  blockedCodes: blocked.map(row => row.code),
  productionAlignmentStatus: status.productionObservation.alignmentStatus,
  deepVerificationApproved: approved.length,
}, null, 2));
