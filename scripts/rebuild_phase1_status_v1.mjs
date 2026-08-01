import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const PHASE1_DIR = path.join(ROOT, 'operations', 'quality-rebase', 'phase1');
const REVIEW_DIR = path.join(PHASE1_DIR, 'reviews');
const RESOLUTION_DIR = path.join(PHASE1_DIR, 'source-resolution');
const COHORT_PATH = path.join(ROOT, 'operations', 'quality-rebase', 'phase1-cohort-50-v1.json');
const CURRENT_PATH = path.join(PHASE1_DIR, 'current-status-v1.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const exists = file => fs.existsSync(file);

const cohort = readJson(COHORT_PATH);
const batches = [
  { index: 1, start: 1, end: 10 },
  { index: 2, start: 11, end: 20 },
  { index: 3, start: 21, end: 30 },
].filter(batch => exists(path.join(PHASE1_DIR, `batch${String(batch.index).padStart(2, '0')}-status-v1.json`)));

const derivedBatches = [];
const allBlocked = [];
for (const batch of batches) {
  const statusPath = path.join(PHASE1_DIR, `batch${String(batch.index).padStart(2, '0')}-status-v1.json`);
  const status = readJson(statusPath);
  const companies = cohort.companies.filter(company => company.order >= batch.start && company.order <= batch.end);
  const rows = [];
  let primaryReviewComplete = 0;
  let independentReviewReady = 0;
  let additionalSourceMappingRequired = 0;
  let sourceIdentityConflictBlocked = 0;

  for (const company of companies) {
    const code = String(company.code);
    const reviewPath = path.join(REVIEW_DIR, `${code}-primary-review-v1.json`);
    const resolutionPath = path.join(RESOLUTION_DIR, `${code}-source-conflict-v1.json`);
    const base = {
      order: company.order,
      code,
      name: company.name,
      market: company.market,
      industry: company.industry,
      document: company.document,
      planPublishedDate: company.planPublishedDate,
      sourceUrl: company.sourceUrl,
    };

    if (exists(reviewPath)) {
      const review = readJson(reviewPath);
      const reviewStatus = review.review?.status ?? 'primary_review_complete_unknown_followup';
      primaryReviewComplete += 1;
      const ready = reviewStatus === 'primary_review_complete_independent_review_pending';
      if (ready) independentReviewReady += 1;
      else additionalSourceMappingRequired += 1;
      rows.push({
        ...base,
        status: reviewStatus,
        reviewFile: path.relative(ROOT, reviewPath).replaceAll(path.sep, '/'),
      });
      if (!ready) {
        allBlocked.push({
          code,
          name: company.name,
          batchId: status.batch.id,
          type: 'additional_source_mapping',
          status: reviewStatus,
          requiredResolution: review.review?.requiredBeforeApproval ?? [],
        });
      }
    } else if (exists(resolutionPath)) {
      const resolution = readJson(resolutionPath);
      sourceIdentityConflictBlocked += 1;
      rows.push({
        ...base,
        status: resolution.decision?.status ?? 'blocked_source_identity_conflict',
        sourceResolutionFile: path.relative(ROOT, resolutionPath).replaceAll(path.sep, '/'),
      });
      allBlocked.push({
        code,
        name: company.name,
        batchId: status.batch.id,
        type: 'source_identity_conflict',
        status: resolution.decision?.status ?? 'blocked_source_identity_conflict',
        requiredResolution: resolution.requiredResolution ?? [],
      });
    } else {
      const existing = status.companies.find(row => String(row.code) === code);
      rows.push({
        ...base,
        status: existing?.status ?? 'official_source_review_pending',
      });
    }
  }

  const counts = {
    primaryReviewComplete,
    independentReviewReady,
    additionalSourceMappingRequired,
    sourceIdentityConflictBlocked,
    independentReviewComplete: 0,
    deepVerificationApproved: 0,
    remainingPrimaryReview: companies.length - primaryReviewComplete,
  };
  const nextStatus = {
    ...status,
    batch: {
      ...status.batch,
      updatedAt: '2026-08-01',
      automaticDeepApprovalAllowed: false,
    },
    counts,
    companies: rows,
  };
  writeJson(statusPath, nextStatus);
  derivedBatches.push({
    id: nextStatus.batch.id,
    orders: nextStatus.batch.orders,
    statusFile: path.relative(ROOT, statusPath).replaceAll(path.sep, '/'),
    ...counts,
  });
}

const totals = derivedBatches.reduce((sum, batch) => ({
  primaryReviewComplete: sum.primaryReviewComplete + batch.primaryReviewComplete,
  independentReviewReady: sum.independentReviewReady + batch.independentReviewReady,
  additionalSourceMappingRequired: sum.additionalSourceMappingRequired + batch.additionalSourceMappingRequired,
  sourceIdentityConflictBlocked: sum.sourceIdentityConflictBlocked + batch.sourceIdentityConflictBlocked,
  independentReviewComplete: sum.independentReviewComplete + batch.independentReviewComplete,
  deepVerificationApproved: sum.deepVerificationApproved + batch.deepVerificationApproved,
  remainingPrimaryReviewInStartedBatches: sum.remainingPrimaryReviewInStartedBatches + batch.remainingPrimaryReview,
}), {
  primaryReviewComplete: 0,
  independentReviewReady: 0,
  additionalSourceMappingRequired: 0,
  sourceIdentityConflictBlocked: 0,
  independentReviewComplete: 0,
  deepVerificationApproved: 0,
  remainingPrimaryReviewInStartedBatches: 0,
});
const companiesQueued = derivedBatches.length * 10;
const current = {
  schemaVersion: 'quality-rebase-phase1-current-status-v1',
  updatedAt: '2026-08-01',
  targetCompanies: cohort.targetCompanies,
  automaticDeepApprovalAllowed: false,
  counts: {
    batchesStarted: derivedBatches.length,
    companiesQueued,
    ...totals,
    remainingPhase1CompaniesNotStarted: cohort.targetCompanies - companiesQueued,
  },
  batches: derivedBatches,
  blockedOrAdditionalWork: allBlocked,
  approvalRule: {
    primaryReviewDoesNotEqualApproval: true,
    minimumDistinctReviewers: 2,
    allFieldLevelEvidenceRequired: true,
    yearUnitScopeValidationRequired: true,
    postPublicationLinkAndRenderCheckRequired: true,
    approvedOnlyAfterAllChecks: true,
  },
  nextProcessingOrder: [
    '開始済みバッチの正式資料選定と一次精読を完了する',
    '独立再確認可能企業を別担当レビューへ送る',
    '追加証跡待ち企業の公式資料・画像・リンクを固定する',
    '資料同一性競合を公式情報で解消する',
    '未開始バッチを10社単位で開始する',
  ],
};
writeJson(CURRENT_PATH, current);

if (current.counts.deepVerificationApproved !== 0) throw new Error('This rebuild must not create approvals');
if (current.counts.primaryReviewComplete !== 20) throw new Error(`Expected 20 primary reviews, got ${current.counts.primaryReviewComplete}`);
if (current.counts.independentReviewReady !== 17) throw new Error(`Expected 17 ready reviews, got ${current.counts.independentReviewReady}`);
if (current.counts.additionalSourceMappingRequired !== 3) throw new Error(`Expected 3 mapping tasks, got ${current.counts.additionalSourceMappingRequired}`);
if (current.counts.sourceIdentityConflictBlocked !== 1) throw new Error(`Expected 1 source conflict, got ${current.counts.sourceIdentityConflictBlocked}`);
console.log(JSON.stringify(current.counts, null, 2));
