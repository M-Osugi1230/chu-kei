import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const PHASE1_DIR = path.join(ROOT, 'operations', 'quality-rebase', 'phase1');
const STATUS_PATH = path.join(PHASE1_DIR, 'batch02-status-v1.json');
const OUTPUT_DIR = path.join(PHASE1_DIR, 'batch02-independent');
const QUEUE_PATH = path.join(PHASE1_DIR, 'batch02-independent-review-queue-v1.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

const status = readJson(STATUS_PATH);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const packets = [];

for (const row of status.companies ?? []) {
  let sourceRecord = null;
  let sourceRaw = null;
  let sourceType = null;
  let queueStatus = 'ready_for_independent_review';
  const blockedReasons = [];

  if (row.reviewFile) {
    sourceRaw = fs.readFileSync(path.join(ROOT, row.reviewFile), 'utf8');
    sourceRecord = JSON.parse(sourceRaw);
    sourceType = 'primary_review';
    if (row.status !== 'primary_review_complete_independent_review_pending') {
      queueStatus = 'blocked_additional_source_mapping';
      blockedReasons.push(...(sourceRecord.review?.requiredBeforeApproval ?? []).filter(reason =>
        /PDF|リンク|マッピング|画像|原寸|固定/u.test(String(reason))));
      if (!blockedReasons.length) blockedReasons.push('追加資料・証跡の固定が必要');
    }
  } else if (row.sourceResolutionFile) {
    sourceRaw = fs.readFileSync(path.join(ROOT, row.sourceResolutionFile), 'utf8');
    sourceRecord = JSON.parse(sourceRaw);
    sourceType = 'source_identity_conflict';
    queueStatus = 'blocked_source_identity_conflict';
    blockedReasons.push(...(sourceRecord.requiredResolution ?? []));
  } else {
    throw new Error(`No source record for ${row.code}`);
  }

  const packet = {
    schemaVersion: 'deep-verification-independent-review-v1',
    company: { code: row.code, name: row.name, order: row.order },
    sourceRecord: {
      type: sourceType,
      file: row.reviewFile ?? row.sourceResolutionFile,
      sha256: sha256(sourceRaw),
    },
    sourceSet: sourceType === 'primary_review' ? {
      officialUrl: sourceRecord.document?.officialUrl ?? null,
      supplementalOfficialUrl: sourceRecord.document?.supplementalOfficialUrl ?? null,
      pageCount: sourceRecord.document?.pageCount ?? null,
      title: sourceRecord.document?.title ?? null,
      publishedDate: sourceRecord.document?.publishedDate ?? null,
    } : {
      officialUrl: sourceRecord.officialSourceObserved?.planPage ?? null,
      title: sourceRecord.officialSourceObserved?.displayedTitle ?? null,
      publishedDate: null,
    },
    queue: { status: queueStatus, blockedReasons, priority: row.order },
    reviewChecks: {
      companyIdentityConfirmed: false,
      formalPlanConfirmed: false,
      publicationDateConfirmed: false,
      fullTextReviewedIndependently: false,
      strategyMatchesSource: false,
      allTargetsMatchSource: false,
      yearUnitScopeValidated: false,
      capitalPolicyMatchesSource: false,
      fieldLevelEvidenceValidated: false,
      forecastActualSeparationValidated: false,
      templateTextAbsent: false,
      linkReachabilityChecked: false,
      renderChecked: false,
    },
    discrepancies: [],
    reviewer: {
      reviewerId: null,
      reviewerType: null,
      independentFromPrimaryReview: null,
      reviewedAt: null,
    },
    decision: { status: 'pending', approved: false, changesRequested: false, reason: null },
    policy: {
      automaticApprovalAllowed: false,
      approvalRequiresAllChecksTrue: true,
      minimumDistinctReviewersAcrossPrimaryAndIndependent: 2,
      deepVerificationApproved: false,
    },
  };

  const file = `${row.code}-independent-review-v1.json`;
  writeJson(path.join(OUTPUT_DIR, file), packet);
  packets.push({
    order: row.order,
    code: row.code,
    name: row.name,
    status: queueStatus,
    packetFile: `operations/quality-rebase/phase1/batch02-independent/${file}`,
    blockedReasons,
  });
}

const queue = {
  schemaVersion: 'phase1-independent-review-queue-v1',
  generatedAt: new Date().toISOString(),
  batchId: status.batch?.id,
  automaticApprovalAllowed: false,
  counts: {
    total: packets.length,
    ready: packets.filter(packet => packet.status === 'ready_for_independent_review').length,
    blockedAdditionalSourceMapping: packets.filter(packet => packet.status === 'blocked_additional_source_mapping').length,
    blockedSourceIdentityConflict: packets.filter(packet => packet.status === 'blocked_source_identity_conflict').length,
    approved: 0,
  },
  approvalRule: {
    allReviewChecksMustBeTrue: true,
    reviewerMustBeIndependent: true,
    minimumDistinctReviewers: 2,
    postPublicationLinkAndRenderCheckRequired: true,
  },
  packets,
};
writeJson(QUEUE_PATH, queue);

if (queue.counts.total !== 10) throw new Error(`Expected 10 packets, got ${queue.counts.total}`);
if (queue.counts.ready !== 7) throw new Error(`Expected 7 ready packets, got ${queue.counts.ready}`);
if (queue.counts.blockedAdditionalSourceMapping !== 2) throw new Error('Expected 2 additional-source blocks');
if (queue.counts.blockedSourceIdentityConflict !== 1) throw new Error('Expected 1 source-identity block');
if (queue.counts.approved !== 0) throw new Error('Packets must not be pre-approved');
console.log(JSON.stringify(queue.counts, null, 2));
