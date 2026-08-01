import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const PHASE1_DIR = path.join(ROOT, 'operations', 'quality-rebase', 'phase1');
const STATUS_PATH = path.join(PHASE1_DIR, 'batch01-status-v1.json');
const OUTPUT_DIR = path.join(PHASE1_DIR, 'independent');
const QUEUE_PATH = path.join(PHASE1_DIR, 'independent-review-queue-v1.json');

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
  const primaryPath = path.join(ROOT, row.reviewFile);
  const primaryRaw = fs.readFileSync(primaryPath, 'utf8');
  const primary = JSON.parse(primaryRaw);
  const blockedReasons = [];

  if (row.code === '6113' && primary.validation?.detailedResultsDeckPageMappingComplete !== true) {
    blockedReasons.push('2026年3月期本決算説明会資料の正式PDF特定とページ単位マッピングが未完了');
  }
  if (row.code === '5631') {
    blockedReasons.push('会社公式PDF URLの到達性を別環境で再確認する');
  }

  const queueStatus = row.code === '6113'
    ? 'blocked_additional_source_mapping'
    : 'ready_for_independent_review';
  const packet = {
    schemaVersion: 'deep-verification-independent-review-v1',
    company: {
      code: row.code,
      name: row.name,
      order: row.order,
    },
    primaryReview: {
      file: row.reviewFile,
      sha256: sha256(primaryRaw),
      status: primary.review?.status ?? null,
      completedAt: primary.review?.primaryReviewCompletedAt ?? null,
    },
    sourceSet: {
      officialUrl: primary.document?.officialUrl ?? null,
      supplementalOfficialUrl: primary.document?.supplementalOfficialUrl ?? null,
      verificationMirrorUrl: primary.document?.verificationMirrorUrl ?? null,
      pageCount: primary.document?.pageCount ?? null,
      title: primary.document?.title ?? null,
      publishedDate: primary.document?.publishedDate ?? null,
    },
    queue: {
      status: queueStatus,
      blockedReasons,
      priority: row.order,
    },
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
    decision: {
      status: 'pending',
      approved: false,
      changesRequested: false,
      reason: null,
    },
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
    packetFile: `operations/quality-rebase/phase1/independent/${file}`,
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
    blocked: packets.filter(packet => packet.status !== 'ready_for_independent_review').length,
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
if (queue.counts.ready !== 9) throw new Error(`Expected 9 ready packets, got ${queue.counts.ready}`);
if (queue.counts.blocked !== 1) throw new Error(`Expected 1 blocked packet, got ${queue.counts.blocked}`);
if (queue.counts.approved !== 0) throw new Error('Independent review packets must not be pre-approved');

console.log(JSON.stringify(queue, null, 2));
