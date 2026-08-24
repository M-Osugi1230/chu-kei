import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INDEPENDENT_STATUS = 'operations/quality-rebase/phase2/independent-review-status-v1.json';
const DEEP_STATUS = 'operations/quality-rebase/phase2/deep-verification-status-v1.json';
const EFFECTIVE_STATUS = 'operations/quality-rebase/phase2/effective-status-v1.json';
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

const independentStatus = readJson(INDEPENDENT_STATUS);
const deepStatus = readJson(DEEP_STATUS);
const effectiveStatus = readJson(EFFECTIVE_STATUS);
const completionRecords = independentStatus.completionRecords ?? [];

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
  return {
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
    finalReviewStatus: blockers.length ? 'blocked_before_final_review' : 'pending_separate_final_reviewer',
    requiredReviewRole: 'final_reviewer',
    selfApprovalAllowed: false,
    automaticApprovalAllowed: false,
    deepVerificationApproved: false,
  };
});

const ready = rows
  .filter(row => row.blockerCount === 0)
  .sort((a, b) => a.priority.localeCompare(b.priority) || a.code.localeCompare(b.code, 'ja'));
const blocked = rows
  .filter(row => row.blockerCount > 0)
  .sort((a, b) => a.code.localeCompare(b.code, 'ja'));

const deepBlockedCodes = new Set((deepStatus.blockedCompanies ?? []).map(row => String(row.code)));
assert(blocked.length === deepStatus.counts?.companiesWithExplicitFinalBlockers, 'Blocked company count differs from Deep Verification status.');
assert(ready.length === deepStatus.counts?.readyForSeparateFinalReview, 'Ready final-review count differs from Deep Verification status.');
assert(blocked.every(row => deepBlockedCodes.has(row.code)), 'Generated blocked queue contains a code absent from Deep Verification status.');
assert((deepStatus.counts?.deepVerificationApproved ?? 0) === 0, 'Deep Verification approvals must remain zero at queue-generation time.');

const queue = {
  schemaVersion: 'quality-rebase-phase3-final-review-queue-v1',
  basis: {
    independentReviewStatusFile: INDEPENDENT_STATUS,
    deepVerificationStatusFile: DEEP_STATUS,
    effectiveStatusFile: EFFECTIVE_STATUS,
    independentStatusUpdatedAt: independentStatus.updatedAt ?? null,
    phase2PrimaryReviewComplete: effectiveStatus.review?.phase2PrimaryReviewComplete ?? null,
    primaryReviewCompleteIncludingPhase1: effectiveStatus.review?.primaryReviewCompleteIncludingPhase1 ?? null,
  },
  counts: {
    independentReviewComplete: rows.length,
    readyForSeparateFinalReview: ready.length,
    companiesWithExplicitFinalBlockers: blocked.length,
    deepVerificationApproved: 0,
  },
  readyForSeparateFinalReview: ready,
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
    deepVerificationApproved: false,
  },
};

const outputPath = path.join(ROOT, OUTPUT);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(queue, null, 2)}\n`);

console.log(JSON.stringify({
  output: OUTPUT,
  counts: queue.counts,
  blockedCodes: blocked.map(row => row.code),
  firstReadyCodes: ready.slice(0, 10).map(row => row.code),
}, null, 2));
