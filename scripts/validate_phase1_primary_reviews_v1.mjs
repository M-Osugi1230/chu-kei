import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const STATUS_PATH = path.join(ROOT, 'operations', 'quality-rebase', 'phase1', 'batch01-status-v1.json');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'quality-rebase', 'phase1-primary-review-validation-v1.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const status = readJson(STATUS_PATH);
const checks = [];
const issues = [];

function check(name, ok, detail = '') {
  const item = { name, ok, detail };
  checks.push(item);
  if (!ok) issues.push(item);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEvidence(target) {
  return isNonEmptyString(target?.evidence)
    && /(?:公式PDF\s*p\.?\s*\d|公式社長メッセージ|公式Web|公式リリース)/u.test(target.evidence);
}

check('batch schema', status.schemaVersion === 'quality-rebase-phase1-batch-status-v1');
check('batch target is 10', status.batch?.targetCompanies === 10);
check('automatic deep approval disabled', status.batch?.automaticDeepApprovalAllowed === false);
check('ten companies registered', Array.isArray(status.companies) && status.companies.length === 10);
check('unique company codes', new Set((status.companies ?? []).map(row => row.code)).size === 10);
check('primary review count is 10', status.counts?.primaryReviewComplete === 10);
check('no independent review claimed', status.counts?.independentReviewComplete === 0);
check('no deep verification claimed', status.counts?.deepVerificationApproved === 0);

const reviewResults = [];
for (const row of status.companies ?? []) {
  const reviewPath = path.join(ROOT, row.reviewFile ?? '');
  const rowIssues = [];
  const rowCheck = (condition, message) => {
    if (!condition) rowIssues.push(message);
  };

  rowCheck(Boolean(row.reviewFile), 'reviewFileがありません');
  rowCheck(fs.existsSync(reviewPath), `レビュー台帳がありません: ${row.reviewFile ?? ''}`);
  if (!fs.existsSync(reviewPath)) {
    reviewResults.push({ code: row.code, name: row.name, passed: false, issues: rowIssues });
    continue;
  }

  const review = readJson(reviewPath);
  rowCheck(review.schemaVersion === 'deep-verification-primary-review-v1', 'schemaVersionが不正です');
  rowCheck(String(review.company?.code) === String(row.code), '企業コードがバッチ台帳と一致しません');
  rowCheck(isNonEmptyString(review.company?.name), '企業名がありません');
  rowCheck(review.document?.formalPlanConfirmed === true, '正式な計画資料の確認が完了していません');
  rowCheck(review.document?.fullTextExtractionComplete === true, '全文抽出が完了していません');
  rowCheck(review.document?.fullTextHumanReviewComplete === false, '未実施の人手全文確認を完了扱いにしています');
  rowCheck(/^https:\/\//u.test(review.document?.officialUrl ?? ''), '公式URLがHTTPSではありません');
  rowCheck(Number.isInteger(review.document?.pageCount) && review.document.pageCount > 0, 'ページ数がありません');
  rowCheck(Array.isArray(review.structuredAnalysis?.strategyThemes) && review.structuredAnalysis.strategyThemes.length >= 3, '戦略テーマが3件未満です');
  rowCheck(Array.isArray(review.structuredAnalysis?.groupTargets) && review.structuredAnalysis.groupTargets.length >= 3, '数値目標が3件未満です');
  rowCheck((review.structuredAnalysis?.groupTargets ?? []).every(target =>
    isNonEmptyString(target.metric)
      && target.target !== null
      && target.target !== undefined
      && isNonEmptyString(target.unit)
      && isNonEmptyString(target.targetYear)
      && isNonEmptyString(target.scope)
      && hasEvidence(target)), '数値目標の年度・単位・範囲・証跡が不足しています');
  rowCheck(review.validation?.strategyStructured === true, '戦略構造化チェックが未完了です');
  rowCheck(review.validation?.metricsValidatedPrimaryPass === true, '一次数値検査が未完了です');
  rowCheck(review.validation?.evidenceLinked === true, '証跡リンクチェックが未完了です');
  rowCheck(review.validation?.yearValidated === true, '年度検査が未完了です');
  rowCheck(review.validation?.unitValidated === true, '単位検査が未完了です');
  rowCheck(review.validation?.scopeValidated === true, '範囲検査が未完了です');
  rowCheck(review.validation?.templateTextRemaining === false, 'テンプレート文が残っています');
  rowCheck(review.validation?.independentDoubleCheck === false, '独立再確認を誤って完了扱いにしています');
  rowCheck(review.review?.automaticApprovalAllowed === false, '自動承認が有効です');
  rowCheck(review.review?.deepVerificationApproved === false, '一次レビューだけで深掘り承認されています');
  rowCheck(Array.isArray(review.review?.requiredBeforeApproval) && review.review.requiredBeforeApproval.length >= 3, '承認前の残作業が明示されていません');
  rowCheck(isNonEmptyString(review.review?.status) && review.review.status.includes('pending'), 'レビュー状態が承認待ちを示していません');

  if (row.code === '6113') {
    rowCheck(review.validation?.detailedResultsDeckPageMappingComplete === false, 'アマダの詳細資料未確認が保持されていません');
    rowCheck(review.review?.status.includes('detailed_deck_mapping_pending'), 'アマダが詳細資料追補キューにありません');
  }

  reviewResults.push({
    code: row.code,
    name: row.name,
    reviewFile: row.reviewFile,
    passed: rowIssues.length === 0,
    issues: rowIssues,
  });
}

check('all ten primary reviews pass', reviewResults.every(row => row.passed), JSON.stringify(reviewResults.filter(row => !row.passed)));
check('exactly one additional source mapping target', status.counts?.additionalSourceMappingRequired === 1);
check('nine independent review ready', status.counts?.independentReviewReady === 9);

const report = {
  schemaVersion: 'phase1-primary-review-validation-v1',
  checkedAt: new Date().toISOString(),
  batchId: status.batch?.id,
  targetCompanies: status.batch?.targetCompanies,
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  automaticDeepApprovalAllowed: false,
  reviewResults,
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
