import { countPrimaryEvidenceReferences } from './evidence_reference_v1.mjs';

export const QUALITY_PROFILE_VERSION = '3.0';

export const QUALITY_CHECK_KEYS = [
  'officialSource',
  'publicationDate',
  'pageEvidence',
  'structuredAnalysis',
  'metricExtraction',
  'progressConnected',
  'humanReviewed',
  'doubleChecked',
];

export const QUALITY_WEIGHTS = {
  officialSource: 15,
  publicationDate: 10,
  pageEvidence: 15,
  structuredAnalysis: 15,
  metricExtraction: 15,
  progressConnected: 10,
  humanReviewed: 10,
  doubleChecked: 10,
};

export const QUALITY_CHECK_LABELS = {
  officialSource: '公式資料URL確認済み',
  publicationDate: '資料公表日確認済み',
  pageEvidence: '一次証跡あり',
  structuredAnalysis: '主要論点構造化済み',
  metricExtraction: '数値・方針抽出済み',
  progressConnected: '進捗評価済み',
  humanReviewed: '旧工程レビュー記録あり',
  doubleChecked: '旧工程ダブルチェック記録あり',
};

export const DEEP_VERIFICATION_REQUIRED_CHECKS = [
  'formalPlanConfirmed',
  'fullTextReviewed',
  'strategyStructured',
  'metricsValidated',
  'evidenceLinked',
  'independentDoubleCheck',
];

const EXTRACTION_STAGES = new Set(['core', 'detailed_extracted']);
const COMPLETED_PROGRESS_ASSESSMENT_STATUSES = new Set([
  'connected',
  'not_comparable',
  'not_disclosed',
]);

const TEMPLATE_PATTERNS = [
  /公式PDF\s*p\.?\s*\d+で[^。]{0,80}(?:数値|方針)を確認/u,
  /対象年度・単位・(?:実績[／/]目標|目標[／/]実績)の区分は原文を参照/u,
  /当該公式開示資料の対象期間/u,
  /主要論点として示す/u,
  /計画・成長戦略・財務目標・KPIに関する記載を確認/u,
  /自動抽出では目標と実績の同一定義/u,
  /\d+ページの一次証跡を登録/u,
  /JPXの企業コード別公式開示資料で/u,
];

const asText = value => value == null ? '' : String(value).normalize('NFKC').trim();

function companyReviewText(company) {
  return [
    company.summary,
    company.period,
    company.revenue,
    company.profit,
    company.margin,
    company.capital,
    company.returnPolicy,
    ...(Array.isArray(company.highlights) ? company.highlights : []),
    ...(Array.isArray(company.warnings) ? company.warnings : []),
    ...(Array.isArray(company.evidenceRefs) ? company.evidenceRefs : []),
    company.progressAssessment?.reason,
    company.progressAssessment?.sourceRef,
  ].map(asText).filter(Boolean).join('\n');
}

export function templatePatternIds(company) {
  const combined = companyReviewText(company);
  return TEMPLATE_PATTERNS
    .map((pattern, index) => ({ id: `template-${index + 1}`, pattern }))
    .filter(item => item.pattern.test(combined))
    .map(item => item.id);
}

export function isTemplateLike(company) {
  const combined = companyReviewText(company);
  const matched = TEMPLATE_PATTERNS.filter(pattern => pattern.test(combined)).length;
  const metricFields = [company.revenue, company.profit, company.margin, company.capital, company.returnPolicy]
    .map(asText)
    .filter(Boolean);
  const genericMetricFields = metricFields.filter(value =>
    TEMPLATE_PATTERNS.some(pattern => pattern.test(value)),
  ).length;
  return matched >= 2 || genericMetricFields >= 2;
}

export function deepVerificationRecord(company) {
  return company.qualityRebase ?? company.deepVerification ?? null;
}

export function hasDeepVerificationApproval(company) {
  const review = deepVerificationRecord(company);
  if (!review || review.status !== 'approved') return false;
  const reviewers = Array.isArray(review.reviewers)
    ? review.reviewers.map(asText).filter(Boolean)
    : [];
  if (new Set(reviewers).size < 2) return false;
  return DEEP_VERIFICATION_REQUIRED_CHECKS.every(key => review[key] === true);
}

export function deepVerificationStatus(company) {
  if (hasDeepVerificationApproval(company)) return 'approved';
  const review = deepVerificationRecord(company);
  if (!review) return 'not_started';
  if (['selected', 'queued', 'in_review', 'changes_requested'].includes(review.status)) return review.status;
  return 'not_started';
}

export function hasPageEvidence(company) {
  return countPrimaryEvidenceReferences(company.evidenceRefs) >= 1;
}

export function hasStructuredAnalysis(company) {
  if (!EXTRACTION_STAGES.has(company.stage)) return false;
  return Boolean(company.summary && company.summary.length >= 20)
    && Boolean((company.highlights || []).length || (company.themes || []).length);
}

export function hasMetricExtraction(company) {
  if (!EXTRACTION_STAGES.has(company.stage)) return false;
  return ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'].some(key => Boolean(company[key]));
}

export function hasCompletedProgressAssessment(company) {
  if (company.flags?.progress === true) return true;
  const assessment = company.progressAssessment;
  if (!assessment || !COMPLETED_PROGRESS_ASSESSMENT_STATUSES.has(assessment.status)) return false;
  if (!assessment.reason || String(assessment.reason).trim().length < 20) return false;
  if (!assessment.sourceRef || !String(assessment.sourceRef).trim()) return false;
  return true;
}

export function buildQualityChecks(company) {
  return {
    officialSource: company.stage !== 'jpx_indexed'
      && typeof company.sourceUrl === 'string'
      && company.sourceUrl.startsWith('https://'),
    publicationDate: Boolean(company.planPublishedDate),
    pageEvidence: hasPageEvidence(company),
    structuredAnalysis: hasStructuredAnalysis(company),
    metricExtraction: hasMetricExtraction(company),
    progressConnected: hasCompletedProgressAssessment(company),
    humanReviewed: company.productionApproval?.reviewApproved === true,
    doubleChecked: company.productionApproval?.independentDoubleCheck === true,
  };
}

export function checksToMask(checks) {
  return QUALITY_CHECK_KEYS.reduce(
    (mask, key, index) => mask | (checks[key] ? (1 << index) : 0),
    0,
  );
}

export function maskToChecks(mask) {
  return Object.fromEntries(
    QUALITY_CHECK_KEYS.map((key, index) => [key, Boolean(mask & (1 << index))]),
  );
}

export function scoreQualityChecks(checks) {
  return QUALITY_CHECK_KEYS.reduce(
    (score, key) => score + (checks[key] ? QUALITY_WEIGHTS[key] : 0),
    0,
  );
}

export function qualityStars(company, checks, score) {
  if (company.stage === 'jpx_indexed') return 1;
  if (hasDeepVerificationApproval(company) && QUALITY_CHECK_KEYS.every(key => checks[key])) return 5;
  if (deepVerificationStatus(company) === 'in_review' && !isTemplateLike(company) && score >= 65) return 4;
  if (!isTemplateLike(company) && score >= 45) return 3;
  if (checks.officialSource) return 2;
  return 1;
}

export function qualityLabel(company, stars) {
  if (stars === 5) return '深掘り確認済み（全文精読・数値検査・独立再確認済み）';
  if (stars === 4) return '深掘りレビュー中';
  if (stars === 3) return '再監査対象（構造化済み・深掘り未承認）';
  if (stars === 2) return '資料確認済み（テンプレート型・深掘り前）';
  return '企業カバレッジのみ';
}

export function buildQualityProfile(company) {
  const checks = buildQualityChecks(company);
  const checkMask = checksToMask(checks);
  const eligibleForScoring = company.stage !== 'jpx_indexed';
  const score = eligibleForScoring ? scoreQualityChecks(checks) : null;
  const stars = qualityStars(company, checks, score ?? 0);
  const templateLike = isTemplateLike(company);
  const verificationStatus = deepVerificationStatus(company);

  return {
    version: QUALITY_PROFILE_VERSION,
    stars,
    score,
    legacyMachineScore: score,
    label: qualityLabel(company, stars),
    eligibleForScoring,
    checkMask,
    templateLike,
    deepVerificationStatus: verificationStatus,
    deepVerified: verificationStatus === 'approved',
  };
}
