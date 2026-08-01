import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const writeJson = (file, value) => {
  const target = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const cohort = readJson('operations/quality-rebase/phase1-cohort-50-v1.json');
const current = readJson('operations/quality-rebase/phase1/current-status-v1.json');
const phase2 = readJson('operations/quality-rebase/phase2-queue-500-v1.json');

assert(cohort.companies.length === 50, `Phase 1 cohort must contain 50 companies, got ${cohort.companies.length}`);
assert(new Set(cohort.companies.map(company => String(company.code))).size === 50, 'Phase 1 cohort contains duplicate company codes');
assert(current.counts.primaryReviewComplete === 50, `Expected 50 primary reviews, got ${current.counts.primaryReviewComplete}`);
assert(current.counts.remainingPrimaryReviewInStartedBatches === 0, 'Started batches still contain unfinished primary reviews');
assert(current.counts.remainingPhase1CompaniesNotStarted === 0, 'Phase 1 still contains unstarted companies');
assert(current.counts.deepVerificationApproved === 0, 'Unexpected automatic or premature deep-verification approval detected');
assert(current.automaticDeepApprovalAllowed === false, 'Automatic deep approval must remain disabled');
assert(current.batches.length === 5, `Expected 5 Phase 1 batches, got ${current.batches.length}`);
assert(current.batches.reduce((sum, batch) => sum + batch.primaryReviewComplete, 0) === 50, 'Batch primary-review totals do not equal 50');
assert(current.batches.reduce((sum, batch) => sum + batch.independentReviewReady, 0) === current.counts.independentReviewReady, 'Independent-review-ready total mismatch');
assert(current.batches.reduce((sum, batch) => sum + batch.additionalSourceMappingRequired, 0) === current.counts.additionalSourceMappingRequired, 'Additional-source total mismatch');

const reviewResults = cohort.companies.map(company => {
  const code = String(company.code);
  const reviewFile = `operations/quality-rebase/phase1/reviews/${code}-primary-review-v1.json`;
  assert(fs.existsSync(path.join(ROOT, reviewFile)), `Missing primary review file: ${reviewFile}`);
  const review = readJson(reviewFile);
  assert(String(review.company?.code) === code, `Company code mismatch in ${reviewFile}`);
  assert(review.review?.automaticApprovalAllowed === false, `Automatic approval enabled in ${reviewFile}`);
  assert(review.review?.deepVerificationApproved === false, `Premature approval detected in ${reviewFile}`);
  assert(review.document?.officialUrl || review.document?.sourceUrl || review.document?.planPageUrl, `Missing official source in ${reviewFile}`);
  assert(review.structuredAnalysis && typeof review.structuredAnalysis === 'object', `Missing structured analysis in ${reviewFile}`);
  assert(review.validation && typeof review.validation === 'object', `Missing validation object in ${reviewFile}`);
  return {
    order: company.order,
    code,
    name: company.name,
    reviewFile,
    reviewStatus: review.review?.status ?? null,
    formalPlanConfirmed: review.document?.formalPlanConfirmed ?? null,
    independentDoubleCheck: review.validation?.independentDoubleCheck === true,
    deepVerificationApproved: review.review?.deepVerificationApproved === true,
  };
});

const blockedCodes = new Set((current.blockedOrAdditionalWork ?? []).map(item => String(item.code)));
assert(blockedCodes.size === current.counts.additionalSourceMappingRequired, 'Blocked/additional-work list count mismatch');
for (const item of reviewResults) {
  const isReady = !blockedCodes.has(item.code);
  if (isReady) assert(item.independentDoubleCheck === false, `Independent check unexpectedly completed before reviewer assignment: ${item.code}`);
}

assert(phase2.queuedAdditional === 450, `Phase 2 queue must contain 450 companies, got ${phase2.queuedAdditional}`);
assert(phase2.batches.length === 9, `Phase 2 must contain 9 batches, got ${phase2.batches.length}`);
const phase2Codes = phase2.batches.flatMap(batch => batch.companies.map(company => String(company.code)));
assert(phase2Codes.length === 450, `Phase 2 flattened queue must contain 450 companies, got ${phase2Codes.length}`);
assert(new Set(phase2Codes).size === 450, 'Phase 2 queue contains duplicate company codes');
assert(!phase2Codes.some(code => cohort.companies.some(company => String(company.code) === code)), 'Phase 1 and Phase 2 company queues overlap');

const firstPhase2Batch = phase2.batches[0];
const phase2Seed = {
  schemaVersion: 'quality-rebase-phase2-batch-status-v1',
  generatedAt: new Date().toISOString(),
  batch: {
    id: `phase2-batch-${String(firstPhase2Batch.batch).padStart(2, '0')}`,
    phase2BatchNumber: firstPhase2Batch.batch,
    targetCompanies: firstPhase2Batch.target,
    automaticDeepApprovalAllowed: false,
    minimumIndependentReviewers: 2,
  },
  counts: {
    queued: firstPhase2Batch.companies.length,
    sourceConfirmed: 0,
    primaryReviewComplete: 0,
    independentReviewReady: 0,
    additionalSourceMappingRequired: 0,
    independentReviewComplete: 0,
    deepVerificationApproved: 0,
  },
  companies: firstPhase2Batch.companies.map((company, index) => ({
    orderInBatch: index + 1,
    code: String(company.code),
    name: company.name,
    market: company.market,
    industry: company.industry,
    candidateDocument: company.document,
    candidatePublishedDate: company.planPublishedDate,
    candidateSourceUrl: company.sourceUrl,
    status: 'queued_for_formal_source_confirmation',
    primaryReviewFile: `operations/quality-rebase/phase2/reviews/${company.code}-primary-review-v1.json`,
  })),
  process: [
    'formal_plan_selection',
    'pdf_full_text_extraction',
    'strategy_metric_capital_policy_structuring',
    'field_level_evidence_linking',
    'year_unit_scope_validation',
    'independent_double_check',
    'approval_before_publication',
    'post_publication_link_and_render_check',
  ],
};

const report = {
  schemaVersion: 'quality-rebase-phase1-completion-gate-v1',
  generatedAt: new Date().toISOString(),
  phase1: {
    cohortCompanies: cohort.companies.length,
    primaryReviewFilesValidated: reviewResults.length,
    independentReviewReady: current.counts.independentReviewReady,
    additionalSourceMappingRequired: current.counts.additionalSourceMappingRequired,
    independentReviewComplete: current.counts.independentReviewComplete,
    deepVerificationApproved: current.counts.deepVerificationApproved,
    automaticDeepApprovalAllowed: false,
  },
  phase2: {
    queuedAdditional: phase2.queuedAdditional,
    batches: phase2.batches.length,
    firstBatchSeeded: firstPhase2Batch.batch,
    firstBatchCompanies: firstPhase2Batch.companies.length,
  },
  invariants: {
    noDuplicatePhase1Codes: true,
    noDuplicatePhase2Codes: true,
    noPhase1Phase2Overlap: true,
    noPrematureApprovals: true,
    allPrimaryReviewFilesPresent: true,
  },
};

writeJson('operations/quality-rebase/phase1/completion-gate-v1.json', report);
writeJson('operations/quality-rebase/phase2/batch02-status-v1.json', phase2Seed);
console.log(JSON.stringify(report, null, 2));
