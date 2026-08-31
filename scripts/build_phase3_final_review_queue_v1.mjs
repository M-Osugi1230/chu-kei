import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INDEPENDENT_STATUS = 'operations/quality-rebase/phase2/independent-review-status-v1.json';
const DEEP_STATUS = 'operations/quality-rebase/phase2/deep-verification-status-v1.json';
const EFFECTIVE_STATUS = 'operations/quality-rebase/phase2/effective-status-v1.json';
const FINAL_REVIEW_DIR = 'operations/quality-rebase/phase3/final-reviews';
const OUTPUT = 'operations/quality-rebase/phase3/generated/final-review-queue-v1.json';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedBlockers(completion) {
  const blockers = completion.finalDeepVerificationBlockers;
  if (!Array.isArray(blockers)) return [];
  return [...new Set(blockers.map(value => String(value).trim()).filter(Boolean))].sort();
}

function priorityFor(completion, blockers) {
  if (blockers.length) return 'blocked';
  if (completion.sourceCorrectionFile || completion.sourceResolutionFile) return 'A';
  if (completion.crossChecks?.visualReview) return 'B';
  return 'C';
}

function loadFinalReviewRecords() {
  const directory = path.join(ROOT, FINAL_REVIEW_DIR);
  if (!fs.existsSync(directory)) return new Map();

  const records = new Map();
  for (const fileName of fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort()) {
    const relativePath = path.posix.join(FINAL_REVIEW_DIR, fileName);
    const record = readJson(relativePath);
    assert(record.schemaVersion === 'quality-rebase-phase3-final-review-v1', `Unexpected final review schema: ${relativePath}`);
    const code = String(record.company?.code ?? '');
    assert(code, `Final review company code missing: ${relativePath}`);
    assert(!records.has(code), `Duplicate Phase 3 final review record: ${code}`);
    records.set(code, { ...record, file: relativePath });
  }
  return records;
}

function validateFinalReviewRecord(record, row, blockers) {
  assert(record.company?.name === row.name, `Final review company name mismatch: ${record.file}`);
  assert(record.reviewer?.role === 'final_reviewer', `Final reviewer role missing: ${record.file}`);
  assert(record.reviewer?.separateFromPrimaryReviewer === true, `Final reviewer must be separate from primary reviewer: ${record.file}`);
  assert(record.reviewer?.separateFromIndependentReviewer === true, `Final reviewer must be separate from independent reviewer: ${record.file}`);
  assert(record.policy?.selfApprovalAllowed === false, `Self approval must remain false: ${record.file}`);
  assert(record.policy?.automaticApprovalAllowed === false, `Automatic approval must remain false: ${record.file}`);
  assert(typeof record.reviewedAt === 'string' && record.reviewedAt.length > 0, `Final review timestamp missing: ${record.file}`);

  const reviewedFiles = record.evidence?.reviewedFiles;
  assert(Array.isArray(reviewedFiles) && reviewedFiles.length >= 3, `Final review evidence list is incomplete: ${record.file}`);
  assert(reviewedFiles.includes(row.primaryReviewFile), `Primary review evidence was not recorded: ${record.file}`);
  assert(reviewedFiles.includes(row.completionFile), `Independent completion evidence was not recorded: ${record.file}`);
  if (row.independentReviewPacket) {
    assert(reviewedFiles.includes(row.independentReviewPacket), `Independent review packet was not recorded: ${record.file}`);
  }

  assert(['approved', 'deferred'].includes(record.decision), `Unsupported final review decision: ${record.file}`);
  if (record.decision === 'approved') {
    assert(blockers.length === 0, `Blocked company cannot be approved: ${record.file}`);
    assert(record.deepVerificationApproved === true, `Approved final review must explicitly set deepVerificationApproved=true: ${record.file}`);
    const checks = record.checks ?? {};
    const requiredChecks = [
      'sourceIdentityConfirmed',
      'yearUnitScopeConfirmed',
      'strategyMetricsConfirmed',
      'capitalAndReturnPolicyConfirmed',
      'auditRecordComplete',
    ];
    for (const key of requiredChecks) {
      assert(checks[key] === true, `Approved final review is missing required check ${key}: ${record.file}`);
    }
  } else {
    assert(record.deepVerificationApproved === false, `Deferred final review may not approve Deep Verification: ${record.file}`);
    assert(Array.isArray(record.reasons) && record.reasons.length > 0, `Deferred final review must record reasons: ${record.file}`);
  }
}

const independentStatus = readJson(INDEPENDENT_STATUS);
const deepStatus = readJson(DEEP_STATUS);
const effectiveStatus = readJson(EFFECTIVE_STATUS);
const completionRecords = independentStatus.completionRecords ?? [];
const finalReviewRecords = loadFinalReviewRecords();

assert(
  effectiveStatus.review?.phase2PrimaryReviewComplete === effectiveStatus.targets?.phase2Additional,
  'Phase 2 primary review must be complete before Phase 3 queue generation.',
);
assert(
  effectiveStatus.review?.primaryReviewCompleteIncludingPhase1 === effectiveStatus.targets?.totalIncludingPhase1,
  'Phase 1 + Phase 2 primary review must reach the configured total before Phase 3.',
);
assert(
  completionRecords.length === independentStatus.counts?.independentReviewComplete,
  'Independent completion record count does not match independent review status.',
);

const seenCodes = new Set();
const rows = completionRecords.map(record => {
  const completion = readJson(record.file);
  const code = String(record.code);
  const name = record.name;

  assert(!seenCodes.has(code), `Duplicate independent completion code: ${code}`);
  seenCodes.add(code);
  assert(String(completion.company?.code) === code, `Completion company code mismatch: ${record.file}`);
  assert(completion.company?.name === name, `Completion company name mismatch: ${record.file}`);
  assert(completion.status === 'independent_review_complete', `Completion is not complete: ${record.file}`);
  assert(completion.review?.automaticApprovalAllowed === false, `Automatic approval must be false: ${record.file}`);
  assert(completion.review?.deepVerificationApproved === false, `Independent completion cannot self-approve Deep Verification: ${record.file}`);

  const blockers = normalizedBlockers(completion);
  const row = {
    code,
    name,
    completionFile: record.file,
    primaryReviewFile: completion.primaryReviewFile ?? null,
    independentReviewPacket: completion.independentReviewPacket ?? null,
    sourceCorrectionFile: completion.sourceCorrectionFile ?? null,
    sourceResolutionFile: completion.sourceResolutionFile ?? null,
    blockers,
    blockerCount: blockers.length,
    priority: priorityFor(completion, blockers),
    requiredReviewRole: 'final_reviewer',
    selfApprovalAllowed: false,
    automaticApprovalAllowed: false,
  };

  const finalReview = finalReviewRecords.get(code);
  if (finalReview) validateFinalReviewRecord(finalReview, row, blockers);

  if (blockers.length > 0) {
    return {
      ...row,
      finalReviewStatus: 'blocked_before_final_review',
      finalReviewFile: finalReview?.file ?? null,
      deepVerificationApproved: false,
    };
  }
  if (!finalReview) {
    return {
      ...row,
      finalReviewStatus: 'pending_separate_final_reviewer',
      finalReviewFile: null,
      deepVerificationApproved: false,
    };
  }
  if (finalReview.decision === 'approved') {
    return {
      ...row,
      finalReviewStatus: 'approved_by_separate_final_reviewer',
      finalReviewFile: finalReview.file,
      deepVerificationApproved: true,
    };
  }
  return {
    ...row,
    finalReviewStatus: 'deferred_after_final_review',
    finalReviewFile: finalReview.file,
    deepVerificationApproved: false,
  };
});

for (const code of finalReviewRecords.keys()) {
  assert(seenCodes.has(code), `Final review record has no independent completion: ${code}`);
}

const pending = rows
  .filter(row => row.finalReviewStatus === 'pending_separate_final_reviewer')
  .sort((a, b) => a.priority.localeCompare(b.priority) || a.code.localeCompare(b.code, 'ja'));
const approved = rows
  .filter(row => row.finalReviewStatus === 'approved_by_separate_final_reviewer')
  .sort((a, b) => a.code.localeCompare(b.code, 'ja'));
const deferred = rows
  .filter(row => row.finalReviewStatus === 'deferred_after_final_review')
  .sort((a, b) => a.code.localeCompare(b.code, 'ja'));
const blocked = rows
  .filter(row => row.finalReviewStatus === 'blocked_before_final_review')
  .sort((a, b) => a.code.localeCompare(b.code, 'ja'));

const initialReadyCount = rows.filter(row => row.blockerCount === 0).length;
const deepBlockedCodes = new Set((deepStatus.blockedCompanies ?? []).map(row => String(row.code)));
assert(blocked.length === deepStatus.counts?.companiesWithExplicitFinalBlockers, 'Blocked company count differs from Phase 2 Deep Verification handoff.');
assert(initialReadyCount === deepStatus.counts?.readyForSeparateFinalReview, 'Initial ready final-review count differs from Phase 2 Deep Verification handoff.');
assert(blocked.every(row => deepBlockedCodes.has(row.code)), 'Generated blocked queue contains a code absent from Deep Verification status.');
assert(pending.length + approved.length + deferred.length === initialReadyCount, 'Phase 3 final-review state does not conserve the initial ready population.');

const queue = {
  schemaVersion: 'quality-rebase-phase3-final-review-queue-v1',
  basis: {
    independentReviewStatusFile: INDEPENDENT_STATUS,
    deepVerificationStatusFile: DEEP_STATUS,
    effectiveStatusFile: EFFECTIVE_STATUS,
    finalReviewDirectory: FINAL_REVIEW_DIR,
    independentStatusUpdatedAt: independentStatus.updatedAt ?? null,
    phase2PrimaryReviewComplete: effectiveStatus.review?.phase2PrimaryReviewComplete ?? null,
    primaryReviewCompleteIncludingPhase1: effectiveStatus.review?.primaryReviewCompleteIncludingPhase1 ?? null,
  },
  counts: {
    independentReviewComplete: rows.length,
    initialReadyForSeparateFinalReview: initialReadyCount,
    pendingSeparateFinalReview: pending.length,
    approvedBySeparateFinalReview: approved.length,
    deferredAfterFinalReview: deferred.length,
    finalReviewCompleted: approved.length + deferred.length,
    companiesWithExplicitFinalBlockers: blocked.length,
    deepVerificationApproved: approved.length,
  },
  readyForSeparateFinalReview: pending,
  approvedBySeparateFinalReview: approved,
  deferredAfterFinalReview: deferred,
  blockedBeforeFinalReview: blocked,
  policy: {
    companyCodeIsCountingUnit: true,
    absenceOfExplicitBlockerDoesNotEqualApproval: true,
    finalReviewerMustBeSeparateRole: true,
    primaryReviewerMaySelfApprove: false,
    independentReviewerMaySelfApproveFinalGate: false,
    automaticFactCompletionAllowed: false,
    automaticApprovalAllowed: false,
    automaticProductionPromotionAllowed: false,
  },
};

const outputPath = path.join(ROOT, OUTPUT);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(queue, null, 2)}\n`);

console.log(JSON.stringify({
  output: OUTPUT,
  counts: queue.counts,
  blockedCodes: blocked.map(row => row.code),
  nextPendingCodes: pending.slice(0, 10).map(row => row.code),
}, null, 2));
