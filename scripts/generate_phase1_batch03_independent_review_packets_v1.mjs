import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const PHASE1_DIR = path.join(ROOT, 'operations', 'quality-rebase', 'phase1');
const STATUS_PATH = path.join(PHASE1_DIR, 'batch03-status-v1.json');
const OUTPUT_DIR = path.join(PHASE1_DIR, 'batch03-independent');
const QUEUE_PATH = path.join(PHASE1_DIR, 'batch03-independent-review-queue-v1.json');

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
  if (!row.reviewFile) throw new Error(`No primary review file for ${row.code}`);

  const sourceRaw = fs.readFileSync(path.join(ROOT, row.reviewFile), 'utf8');
  const sourceRecord = JSON.parse(sourceRaw);
  const blockedReasons = [];
  let queueStatus = 'ready_for_independent_review';

  if (sourceRecord.document?.fullTextHumanReviewComplete !== true) {
    queueStatus = 'blocked_additional_source_mapping';
    blockedReasons.push(...(sourceRecord.review?.requiredBeforeApproval ?? []).filter(reason =>
      /画像|原寸|リンク|表示|マッピング|固定/u.test(String(reason))));
    if (!blockedReasons.length) blockedReasons.push('全文・画像証跡の人手確認と固定が必要');
  }

  const packet = {
    schemaVersion: 'deep-verification-independent-review-v1',
    company: { code: row.code, name: row.name, order: row.order },
    sourceRecord: {
      type: 'primary_review',
      file: row.reviewFile,
      sha256: sha256(sourceRaw),
    },
    sourceSet: {
      officialUrl: sourceRecord.document?.officialUrl ?? null,
      supplementalOfficialUrl: sourceRecord.document?.supplementalOfficialUrl ?? null,
      verificationMirrorUrl: sourceRecord.document?.verificationMirrorUrl ?? null,
      contentType: sourceRecord.document?.contentType ?? null,
      pageCount: sourceRecord.document?.pageCount ?? null,
      title: sourceRecord.document?.title ?? null,
      publishedDate: sourceRecord.document?.publishedDate ?? null,
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
      revisionHistoryValidated: false,
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
    packetFile: `operations/quality-rebase/phase1/batch03-independent/${file}`,
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
if (queue.counts.blockedAdditionalSourceMapping !== 1) throw new Error('Expected 1 additional-source block');
if (queue.counts.approved !== 0) throw new Error('Packets must not be pre-approved');

console.log(JSON.stringify(queue.counts, null, 2));
