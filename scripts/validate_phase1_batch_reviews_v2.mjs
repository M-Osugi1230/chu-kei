import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const statusArg = process.argv[2] || 'operations/quality-rebase/phase1/batch02-status-v1.json';
const STATUS_PATH = path.resolve(ROOT, statusArg);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const status = readJson(STATUS_PATH);
const batchId = status.batch?.id || path.basename(statusArg, '.json');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'quality-rebase', `${batchId}-review-validation-v2.json`);
const checks = [];
const issues = [];

function check(name, ok, detail = '') {
  const item = { name, ok, detail };
  checks.push(item);
  if (!ok) issues.push(item);
}

const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const evidencePresent = value => nonEmpty(value)
  && /(?:公式PDF\s*p\.?\s*\d|公式Web|公式社長メッセージ|公式リリース|会社公式|公式計画画像)/u.test(value);

check('batch schema', status.schemaVersion === 'quality-rebase-phase1-batch-status-v1');
check('automatic deep approval disabled', status.batch?.automaticDeepApprovalAllowed === false);
check('company list matches target', Array.isArray(status.companies)
  && status.companies.length === status.batch?.targetCompanies,
`actual=${status.companies?.length ?? 0}, target=${status.batch?.targetCompanies ?? null}`);
check('company codes unique', new Set((status.companies ?? []).map(row => String(row.code))).size === (status.companies ?? []).length);
check('no batch-level approval claimed', status.counts?.deepVerificationApproved === 0
  && status.counts?.independentReviewComplete === 0);

const results = [];
let primaryComplete = 0;
let ready = 0;
let mappingRequired = 0;
let conflicts = 0;

for (const row of status.companies ?? []) {
  const rowIssues = [];
  const require = (condition, message) => {
    if (!condition) rowIssues.push(message);
  };

  if (row.reviewFile) {
    primaryComplete += 1;
    const reviewPath = path.resolve(ROOT, row.reviewFile);
    require(fs.existsSync(reviewPath), `レビュー台帳がありません: ${row.reviewFile}`);
    if (fs.existsSync(reviewPath)) {
      const review = readJson(reviewPath);
      const isPdf = String(review.document?.contentType ?? '').includes('application/pdf');
      const targets = review.structuredAnalysis?.groupTargets ?? [];
      require(review.schemaVersion === 'deep-verification-primary-review-v1', 'レビューschemaが不正です');
      require(String(review.company?.code) === String(row.code), '企業コードがバッチ台帳と一致しません');
      require(nonEmpty(review.company?.name), '企業名がありません');
      require(review.document?.formalPlanConfirmed === true, '正式計画資料の確認が未完了です');
      require(review.document?.fullTextExtractionComplete === true, '全文抽出が未完了です');
      require(review.document?.fullTextHumanReviewComplete === false, '人手全文確認を誤って完了扱いにしています');
      require(/^https:\/\//u.test(review.document?.officialUrl ?? ''), '公式URLがHTTPSではありません');
      require(!isPdf || (Number.isInteger(review.document?.pageCount) && review.document.pageCount > 0), 'PDFのページ数がありません');
      require(Array.isArray(review.structuredAnalysis?.strategyThemes)
        && review.structuredAnalysis.strategyThemes.length >= 3, '戦略テーマが3件未満です');
      require(Array.isArray(targets) && targets.length >= 3, '構造化した目標が3件未満です');
      require(targets.every(target => nonEmpty(target.metric)
        && target.target !== null
        && target.target !== undefined
        && nonEmpty(target.unit)
        && nonEmpty(target.targetYear)
        && nonEmpty(target.scope)
        && evidencePresent(target.evidence)), '目標の年度・単位・範囲・証跡が不足しています');
      require(review.validation?.strategyStructured === true, '戦略構造化チェックが未完了です');
      require(review.validation?.metricsValidatedPrimaryPass === true, '一次数値検査が未完了です');
      require(review.validation?.evidenceLinked === true, '証跡リンクが未完了です');
      require(review.validation?.yearValidated === true, '年度検査が未完了です');
      require(review.validation?.unitValidated === true, '単位検査が未完了です');
      require(review.validation?.scopeValidated === true, '範囲検査が未完了です');
      require(review.validation?.templateTextRemaining === false, 'テンプレート文が残っています');
      require(review.validation?.independentDoubleCheck === false, '独立再確認を誤って完了扱いにしています');
      require(review.review?.automaticApprovalAllowed === false, '自動承認が有効です');
      require(review.review?.deepVerificationApproved === false, '一次レビューだけで最高品質承認されています');
      require(nonEmpty(review.review?.status) && review.review.status.includes('pending'), 'レビュー状態が承認待ちを示していません');
      require(Array.isArray(review.review?.requiredBeforeApproval)
        && review.review.requiredBeforeApproval.length >= 3, '承認前残作業が不足しています');
    }

    if (row.status === 'primary_review_complete_independent_review_pending') ready += 1;
    else mappingRequired += 1;
  } else if (row.sourceResolutionFile) {
    conflicts += 1;
    const conflictPath = path.resolve(ROOT, row.sourceResolutionFile);
    require(fs.existsSync(conflictPath), `資料同一性台帳がありません: ${row.sourceResolutionFile}`);
    if (fs.existsSync(conflictPath)) {
      const conflict = readJson(conflictPath);
      require(conflict.schemaVersion === 'phase1-source-identity-conflict-v1', '資料同一性schemaが不正です');
      require(String(conflict.company?.code) === String(row.code), '資料同一性台帳の企業コードが一致しません');
      require(conflict.decision?.status === 'blocked_source_identity_conflict', '資料競合が隔離されていません');
      require(conflict.decision?.primaryReviewComplete === false, '競合資料を一次レビュー完了扱いにしています');
      require(conflict.decision?.deepVerificationApproved === false, '競合資料を最高品質承認しています');
      require(conflict.decision?.automaticApprovalAllowed === false, '競合資料で自動承認が有効です');
      require(Array.isArray(conflict.conflicts) && conflict.conflicts.length > 0, '資料競合内容がありません');
      require(Array.isArray(conflict.requiredResolution) && conflict.requiredResolution.length >= 3, '解消条件が不足しています');
    }
  } else {
    require(false, 'reviewFileまたはsourceResolutionFileがありません');
  }

  results.push({
    order: row.order,
    code: row.code,
    name: row.name,
    status: row.status,
    passed: rowIssues.length === 0,
    issues: rowIssues,
  });
}

check('all company records pass', results.every(row => row.passed), JSON.stringify(results.filter(row => !row.passed)));
check('primary review count matches', primaryComplete === status.counts?.primaryReviewComplete,
  `derived=${primaryComplete}, declared=${status.counts?.primaryReviewComplete}`);
check('independent-ready count matches', ready === status.counts?.independentReviewReady,
  `derived=${ready}, declared=${status.counts?.independentReviewReady}`);
check('mapping-required count matches', mappingRequired === status.counts?.additionalSourceMappingRequired,
  `derived=${mappingRequired}, declared=${status.counts?.additionalSourceMappingRequired}`);
check('source-conflict count matches', conflicts === (status.counts?.sourceIdentityConflictBlocked ?? 0),
  `derived=${conflicts}, declared=${status.counts?.sourceIdentityConflictBlocked ?? 0}`);
check('remaining review count matches', status.batch.targetCompanies - primaryComplete === status.counts?.remainingPrimaryReview,
  `derived=${status.batch.targetCompanies - primaryComplete}, declared=${status.counts?.remainingPrimaryReview}`);

const report = {
  schemaVersion: 'phase1-batch-review-validation-v2',
  checkedAt: new Date().toISOString(),
  statusFile: statusArg,
  batchId,
  counts: {
    target: status.batch?.targetCompanies,
    primaryComplete,
    ready,
    mappingRequired,
    sourceIdentityConflicts: conflicts,
    approved: 0,
  },
  automaticDeepApprovalAllowed: false,
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  results,
  checks,
  issues,
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
}
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
