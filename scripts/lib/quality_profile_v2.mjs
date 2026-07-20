import { countPrimaryEvidenceReferences } from './evidence_reference_v1.mjs';

export const QUALITY_PROFILE_VERSION = '2.4';

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
  officialSource: '公式資料確認済み',
  publicationDate: '資料公表日確認済み',
  pageEvidence: '一次証跡あり',
  structuredAnalysis: '主要論点構造化済み',
  metricExtraction: '数値・方針抽出済み',
  progressConnected: '進捗評価済み',
  humanReviewed: '個別レビュー済み',
  doubleChecked: '独立再検証済み',
};

const EXTRACTION_STAGES = new Set(['core', 'detailed_extracted']);
const COMPLETED_PROGRESS_ASSESSMENT_STATUSES = new Set([
  'connected',
  'not_comparable',
  'not_disclosed',
]);

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
  if (QUALITY_CHECK_KEYS.every(key => checks[key])) return 5;
  if (score >= 65) return 4;
  if (score >= 45) return 3;
  if (checks.officialSource) return 2;
  return 1;
}

export function qualityLabel(company, stars) {
  if (stars === 5) return '最高品質（進捗評価・証跡・独立再検証済み）';
  if (company.stage === 'core') return '本番品質（証跡・承認補修対象）';
  if (company.stage === 'detailed_extracted' && stars === 4) return '詳細抽出済みβ（証跡充足）';
  if (company.stage === 'detailed_extracted') return '詳細抽出済みβ';
  if (company.stage === 'source_indexed') return '一次確認β';
  return 'カバレッジβ';
}

export function buildQualityProfile(company) {
  const checks = buildQualityChecks(company);
  const checkMask = checksToMask(checks);
  const eligibleForScoring = company.stage !== 'jpx_indexed';
  const score = eligibleForScoring ? scoreQualityChecks(checks) : null;
  const stars = qualityStars(company, checks, score ?? 0);

  return {
    version: QUALITY_PROFILE_VERSION,
    stars,
    score,
    label: qualityLabel(company, stars),
    eligibleForScoring,
    checkMask,
  };
}
