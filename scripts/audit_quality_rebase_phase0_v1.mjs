import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OPS_DIR = path.join(ROOT, 'operations', 'quality-rebase');
const BASELINE_PATH = path.join(OPS_DIR, 'phase0-baseline-v1.json');
const REPORT_PATH = path.join(OPS_DIR, 'phase0-audit-report-v1.json');
const COMPANY_CSV_PATH = path.join(OPS_DIR, 'phase0-company-classification-v1.csv');
const PHASE1_PATH = path.join(OPS_DIR, 'phase1-cohort-50-v1.json');
const PHASE2_PATH = path.join(OPS_DIR, 'phase2-queue-500-v1.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const asText = value => value == null ? '' : String(value).normalize('NFKC').trim();
const companyCode = company => asText(company.code ?? company.companyCode);

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))),
  );
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) {
    throw new Error(`Bundle SHA-256 mismatch: ${digest} !== ${manifest.sha256}`);
  }
  const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  if (!Array.isArray(bundle.companies)) throw new Error('bundle.companies must be an array');
  if (!Array.isArray(bundle.progress)) throw new Error('bundle.progress must be an array');
  return { manifest, bundle };
}

const TEMPLATE_PATTERNS = [
  {
    id: 'generic_metric_confirmation',
    regex: /公式PDF\s*p\.?\s*\d+で[^。]{0,80}(?:数値|方針)を確認/u,
  },
  {
    id: 'refer_to_original_for_definition',
    regex: /対象年度・単位・(?:実績[／/]目標|目標[／/]実績)の区分は原文を参照/u,
  },
  {
    id: 'generic_period',
    regex: /当該公式開示資料の対象期間/u,
  },
  {
    id: 'generic_topics_statement',
    regex: /主要論点として示す/u,
  },
  {
    id: 'generic_page_evidence',
    regex: /計画・成長戦略・財務目標・KPIに関する記載を確認/u,
  },
  {
    id: 'automatic_extraction_not_comparable',
    regex: /自動抽出では目標と実績の同一定義/u,
  },
  {
    id: 'generic_primary_evidence_count',
    regex: /\d+ページの一次証跡を登録/u,
  },
  {
    id: 'generic_jpx_summary',
    regex: /JPXの企業コード別公式開示資料で/u,
  },
];

const FORMAL_PLAN_PATTERN = /(?:中期|中長期|長期)?経営計画|中期経営戦略|中長期経営戦略|事業計画|経営方針|経営戦略|成長戦略/u;
const FINANCIAL_STATEMENT_PATTERN = /決算短信|決算説明(?:会)?資料|四半期決算|通期決算|決算補足|決算概要|決算関連/u;
const ADMINISTRATIVE_DOCUMENT_PATTERN = /株主優待|人事異動|定款|株式分割|公開買付|上場廃止|自己株式取得|配当予想の修正/u;
const SPECIFIC_METRIC_PATTERN = /(?:\d[\d,.]*\s*(?:億円|百万円|千円|円|%|％|倍|人|件))|(?:ROE|ROIC|ROA|DOE|EBITDA|EPS|CAGR)/iu;

function evidencePageCount(company) {
  const refs = Array.isArray(company.evidenceRefs) ? company.evidenceRefs : [];
  const keys = new Set();
  for (const ref of refs) {
    const text = asText(ref);
    const pdf = text.match(/公式PDF\s*p\.?\s*(\d+)/iu);
    if (pdf) keys.add(`pdf:${pdf[1]}`);
    const web = text.match(/公式(?:Web|ウェブ)[^:：]{0,20}[:：]\s*(.+)$/iu);
    if (web) keys.add(`web:${web[1].slice(0, 120)}`);
  }
  return keys.size;
}

function deepVerificationApproved(company) {
  const review = company.qualityRebase ?? company.deepVerification ?? null;
  if (!review || review.status !== 'approved') return false;
  const reviewers = Array.isArray(review.reviewers) ? review.reviewers.filter(Boolean) : [];
  const requiredChecks = [
    review.formalPlanConfirmed,
    review.fullTextReviewed,
    review.strategyStructured,
    review.metricsValidated,
    review.evidenceLinked,
    review.independentDoubleCheck,
  ];
  return requiredChecks.every(Boolean) && new Set(reviewers).size >= 2;
}

function marketSegment(company) {
  const text = `${asText(company.market)} ${asText(company.marketSegment)} ${asText(company.category)}`;
  if (/Prime|プライム/iu.test(text)) return 'Prime';
  if (/Standard|スタンダード/iu.test(text)) return 'Standard';
  if (/Growth|グロース/iu.test(text)) return 'Growth';
  return 'Other';
}

function industryName(company) {
  return asText(company.industry33 ?? company.industry ?? company.category?.split('/')[0]) || '未分類';
}

function parseDate(value) {
  const text = asText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function recentPlanScore(company, referenceDate) {
  const date = parseDate(company.planPublishedDate);
  if (!date) return { withinThreeYears: false, daysOld: null, score: 0 };
  const daysOld = Math.floor((referenceDate.getTime() - date.getTime()) / 86400000);
  const withinThreeYears = daysOld >= 0 && daysOld <= 1096;
  const score = withinThreeYears ? Math.max(0, 24 - Math.floor(daysOld / 60)) : 0;
  return { withinThreeYears, daysOld, score };
}

function progressCompanyCode(row) {
  return asText(row.companyCode ?? row.code ?? row.company?.code ?? row.companyId);
}

function progressMetricName(row) {
  return asText(row.metricName ?? row.metric ?? row.name ?? row.label ?? row.kpi);
}

function normalizedMetricName(value) {
  const text = asText(value)
    .replaceAll('％', '%')
    .replace(/\s+/g, '')
    .replace(/連結|単体|調整後|Non-GAAP|IFRS/giu, '');
  const rules = [
    [/売上(?:高|収益)|営業収益|売上収益/iu, '売上高・売上収益'],
    [/営業利益|事業利益/iu, '営業利益・事業利益'],
    [/経常利益/iu, '経常利益'],
    [/当期純利益|親会社株主に帰属する.*利益|最終利益/iu, '当期純利益'],
    [/営業利益率|事業利益率/iu, '営業利益率・事業利益率'],
    [/ROE|自己資本利益率/iu, 'ROE'],
    [/ROIC|投下資本利益率/iu, 'ROIC'],
    [/ROA|総資産利益率/iu, 'ROA'],
    [/EBITDA/iu, 'EBITDA'],
    [/EPS|1株当たり利益/iu, 'EPS'],
    [/DOE|株主資本配当率/iu, 'DOE'],
    [/配当性向/iu, '配当性向'],
  ];
  for (const [pattern, normalized] of rules) {
    if (pattern.test(text)) return normalized;
  }
  return text || '名称なし';
}

function classifyCompany(company, referenceDate, progressCodes) {
  const code = companyCode(company);
  const document = asText(company.document);
  const fields = [
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
  ].map(asText).filter(Boolean);
  const combined = fields.join('\n');
  const templatePatternIds = TEMPLATE_PATTERNS
    .filter(pattern => pattern.regex.test(combined))
    .map(pattern => pattern.id);
  const metricFields = [company.revenue, company.profit, company.margin, company.capital, company.returnPolicy]
    .map(asText)
    .filter(Boolean);
  const genericMetricFields = metricFields.filter(value =>
    TEMPLATE_PATTERNS.some(pattern => pattern.regex.test(value)),
  ).length;
  const specificMetricFields = metricFields.filter(value => SPECIFIC_METRIC_PATTERN.test(value)).length;
  const templateLike = templatePatternIds.length >= 2 || genericMetricFields >= 2;
  const formalPlan = FORMAL_PLAN_PATTERN.test(document);
  const financialStatementSource = FINANCIAL_STATEMENT_PATTERN.test(document);
  const administrativeDocument = ADMINISTRATIVE_DOCUMENT_PATTERN.test(document);
  const pageEvidence = evidencePageCount(company);
  const officialSource = /^https:\/\//u.test(asText(company.sourceUrl));
  const deepVerified = deepVerificationApproved(company);
  const recent = recentPlanScore(company, referenceDate);
  const segment = marketSegment(company);
  const industry = industryName(company);
  const productionApproved = company.productionApproval?.reviewApproved === true;
  const doubleChecked = company.productionApproval?.independentDoubleCheck === true;
  const progressConnected = progressCodes.has(code) || company.flags?.progress === true;
  const provisionalCandidate = !deepVerified
    && formalPlan
    && !financialStatementSource
    && !administrativeDocument
    && officialSource
    && pageEvidence >= 2
    && productionApproved
    && doubleChecked;

  const phaseScore =
    (formalPlan ? 35 : 0)
    + (!financialStatementSource ? 15 : -30)
    + (!administrativeDocument ? 10 : -50)
    + (officialSource ? 10 : -30)
    + Math.min(pageEvidence, 5) * 4
    + Math.min(specificMetricFields, 5) * 6
    + recent.score
    + (progressConnected ? 8 : 0)
    + (!templateLike ? 20 : -20)
    + (productionApproved ? 5 : 0)
    + (doubleChecked ? 5 : 0);

  return {
    code,
    name: asText(company.name),
    market: segment,
    industry,
    stage: asText(company.stage),
    document,
    planPublishedDate: asText(company.planPublishedDate) || null,
    sourceUrl: asText(company.sourceUrl) || null,
    deepVerified,
    provisionalCandidate,
    templateLike,
    formalPlan,
    financialStatementSource,
    administrativeDocument,
    officialSource,
    pageEvidence,
    genericMetricFields,
    specificMetricFields,
    progressConnected,
    productionApproved,
    doubleChecked,
    withinThreeYears: recent.withinThreeYears,
    templatePatternIds,
    phaseScore,
  };
}

function selectBalanced(rows, quotas, limit, options = {}) {
  const maxPerIndustrySteps = options.maxPerIndustrySteps ?? [2, 3, 4, Number.POSITIVE_INFINITY];
  const selected = [];
  const selectedCodes = new Set();
  const marketCounts = new Map();
  const industryCounts = new Map();
  const sorted = [...rows].sort((a, b) => b.phaseScore - a.phaseScore || a.code.localeCompare(b.code));

  for (const maxPerIndustry of maxPerIndustrySteps) {
    let added = true;
    while (selected.length < limit && added) {
      added = false;
      for (const row of sorted) {
        if (selected.length >= limit) break;
        if (selectedCodes.has(row.code)) continue;
        const marketQuota = quotas[row.market] ?? 0;
        const currentMarket = marketCounts.get(row.market) ?? 0;
        if (currentMarket >= marketQuota) continue;
        const currentIndustry = industryCounts.get(row.industry) ?? 0;
        if (currentIndustry >= maxPerIndustry) continue;
        selected.push(row);
        selectedCodes.add(row.code);
        marketCounts.set(row.market, currentMarket + 1);
        industryCounts.set(row.industry, currentIndustry + 1);
        added = true;
      }
    }
  }

  return selected;
}

const baseline = readJson(BASELINE_PATH);
const { manifest, bundle } = readBundle();
const referenceDate = new Date(`${baseline.referenceDate}T00:00:00Z`);
const progressCodes = new Set(bundle.progress.map(progressCompanyCode).filter(Boolean));
const classifications = bundle.companies.map(company => classifyCompany(company, referenceDate, progressCodes));

const count = predicate => classifications.filter(predicate).length;
const deepVerifiedRows = classifications.filter(row => row.deepVerified);
const provisionalRows = classifications.filter(row => row.provisionalCandidate && !row.templateLike);
const templateRows = classifications.filter(row => row.templateLike);
const financialStatementRows = classifications.filter(row => row.financialStatementSource);
const formalPlanRows = classifications.filter(row => row.formalPlan && !row.financialStatementSource && !row.administrativeDocument);
const unclassifiedRows = classifications.filter(row => !row.deepVerified && !row.templateLike && !row.provisionalCandidate);

const metricVariants = new Map();
for (const row of bundle.progress) {
  const original = progressMetricName(row);
  const normalized = normalizedMetricName(original);
  if (!metricVariants.has(normalized)) metricVariants.set(normalized, new Map());
  const variants = metricVariants.get(normalized);
  variants.set(original || '名称なし', (variants.get(original || '名称なし') ?? 0) + 1);
}
const metricNormalization = [...metricVariants.entries()]
  .map(([normalized, variants]) => ({
    normalized,
    total: [...variants.values()].reduce((sum, value) => sum + value, 0),
    variants: [...variants.entries()]
      .map(([name, occurrences]) => ({ name, occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => b.total - a.total || a.normalized.localeCompare(b.normalized));

const phaseEligible = classifications.filter(row =>
  !row.deepVerified
  && row.provisionalCandidate
  && row.withinThreeYears
  && row.market !== 'Other'
  && row.phaseScore > 0,
);
const phase1Selected = selectBalanced(
  phaseEligible,
  baseline.phase1.marketQuota,
  baseline.phase1.targetCompanies,
);
if (phase1Selected.length !== baseline.phase1.targetCompanies) {
  throw new Error(`Unable to select Phase 1 cohort: ${phase1Selected.length}/${baseline.phase1.targetCompanies}`);
}

const phase1Codes = new Set(phase1Selected.map(row => row.code));
const phase2Eligible = classifications
  .filter(row =>
    !row.deepVerified
    && row.provisionalCandidate
    && row.market !== 'Other'
    && !phase1Codes.has(row.code)
    && row.phaseScore > 0,
  )
  .sort((a, b) => b.phaseScore - a.phaseScore || a.code.localeCompare(b.code));
const phase2AdditionalTarget = baseline.phase2.targetCompanies - baseline.phase1.targetCompanies;
const phase2Additional = phase2Eligible.slice(0, phase2AdditionalTarget);
const phase2Batches = [];
for (let offset = 0; offset < phase2Additional.length; offset += baseline.phase2.batchSize) {
  phase2Batches.push({
    batch: phase2Batches.length + 2,
    target: Math.min(baseline.phase2.batchSize, phase2Additional.length - offset),
    companies: phase2Additional.slice(offset, offset + baseline.phase2.batchSize).map(row => ({
      code: row.code,
      name: row.name,
      market: row.market,
      industry: row.industry,
      document: row.document,
      planPublishedDate: row.planPublishedDate,
      sourceUrl: row.sourceUrl,
      phaseScore: row.phaseScore,
      templatePatternIds: row.templatePatternIds,
    })),
  });
}

const report = {
  schemaVersion: 'quality-rebase-phase0-audit-v1',
  generatedAt: new Date().toISOString(),
  referenceDate: baseline.referenceDate,
  bundle: {
    sha256: manifest.sha256,
    companyCount: bundle.companies.length,
    progressRecordCount: bundle.progress.length,
  },
  policy: {
    legacyFiveStarIsDeepVerification: false,
    deepVerifiedRequiresExplicitQualityRebaseApproval: true,
    automaticDeepVerificationAllowed: false,
    templateTextMayNotQualifyAsDeepVerified: true,
  },
  derived: {
    deepVerified: deepVerifiedRows.length,
    provisionalCandidates: provisionalRows.length,
    templateLike: templateRows.length,
    formalPlanCandidates: formalPlanRows.length,
    financialStatementReSearch: financialStatementRows.length,
    unclassifiedForManualReview: unclassifiedRows.length,
    progressRecords: bundle.progress.length,
    progressCompanies: progressCodes.size,
    metricNormalizedGroups: metricNormalization.length,
    metricOriginalVariants: metricNormalization.reduce((sum, row) => sum + row.variants.length, 0),
  },
  roadmapBaseline: baseline.roadmapBaseline,
  baselineVariance: {
    provisionalCandidates: provisionalRows.length - baseline.roadmapBaseline.provisionalCompanies,
    templateLike: templateRows.length - baseline.roadmapBaseline.templateTypeCompanies,
    financialStatementReSearch: financialStatementRows.length - baseline.roadmapBaseline.financialStatementCompanies,
    progressRecords: bundle.progress.length - baseline.roadmapBaseline.progressRecords,
    progressCompanies: progressCodes.size - baseline.roadmapBaseline.progressConnectedCompanies,
  },
  templatePatternCounts: Object.fromEntries(
    TEMPLATE_PATTERNS.map(pattern => [
      pattern.id,
      count(row => row.templatePatternIds.includes(pattern.id)),
    ]),
  ),
  marketBreakdown: Object.fromEntries(
    ['Prime', 'Standard', 'Growth', 'Other'].map(market => [
      market,
      count(row => row.market === market),
    ]),
  ),
  phase1: {
    target: baseline.phase1.targetCompanies,
    selected: phase1Selected.length,
    marketQuota: baseline.phase1.marketQuota,
    actualMarket: Object.fromEntries(
      ['Prime', 'Standard', 'Growth'].map(market => [
        market,
        phase1Selected.filter(row => row.market === market).length,
      ]),
    ),
    industries: new Set(phase1Selected.map(row => row.industry)).size,
  },
  phase2: {
    targetIncludingPhase1: baseline.phase2.targetCompanies,
    additionalTarget: phase2AdditionalTarget,
    queuedAdditional: phase2Additional.length,
    batchSize: baseline.phase2.batchSize,
    batchesIncludingPhase1: 1 + phase2Batches.length,
  },
  metricNormalization,
  limitations: [
    'URLのHTTP到達性はこの監査では検査しない。既知404は別キューで修復する。',
    'テンプレート検出は意味上の精読完了を証明しない。深掘り済み判定には新しい二段階承認が必要。',
    'Phase 1・2の候補選定は処理順を決めるものであり、公開承認ではない。',
  ],
};

writeJson(REPORT_PATH, report);
writeJson(PHASE1_PATH, {
  schemaVersion: 'quality-rebase-phase1-cohort-v1',
  generatedAt: report.generatedAt,
  referenceDate: baseline.referenceDate,
  targetCompanies: baseline.phase1.targetCompanies,
  marketQuota: baseline.phase1.marketQuota,
  approvalPolicy: baseline.approvalPolicy,
  companies: phase1Selected.map((row, index) => ({
    order: index + 1,
    code: row.code,
    name: row.name,
    market: row.market,
    industry: row.industry,
    document: row.document,
    planPublishedDate: row.planPublishedDate,
    sourceUrl: row.sourceUrl,
    phaseScore: row.phaseScore,
    templatePatternIds: row.templatePatternIds,
    status: 'selected_for_full_review',
  })),
});
writeJson(PHASE2_PATH, {
  schemaVersion: 'quality-rebase-phase2-queue-v1',
  generatedAt: report.generatedAt,
  targetCompaniesIncludingPhase1: baseline.phase2.targetCompanies,
  phase1Companies: phase1Selected.length,
  additionalTarget: phase2AdditionalTarget,
  queuedAdditional: phase2Additional.length,
  batchSize: baseline.phase2.batchSize,
  approvalPolicy: baseline.approvalPolicy,
  batches: phase2Batches,
});

const csvHeader = [
  'code', 'name', 'market', 'industry', 'stage', 'deepVerified', 'provisionalCandidate',
  'templateLike', 'formalPlan', 'financialStatementSource', 'administrativeDocument',
  'pageEvidence', 'genericMetricFields', 'specificMetricFields', 'progressConnected',
  'withinThreeYears', 'phaseScore', 'document', 'planPublishedDate', 'sourceUrl',
  'templatePatternIds',
];
const csv = [csvHeader.map(csvCell).join(',')]
  .concat(classifications.map(row => csvHeader.map(key =>
    csvCell(key === 'templatePatternIds' ? row.templatePatternIds.join('|') : row[key]),
  ).join(',')))
  .join('\n');
fs.writeFileSync(COMPANY_CSV_PATH, `${csv}\n`);

if (bundle.companies.length !== baseline.roadmapBaseline.totalCompanies) {
  throw new Error(`Company count changed: ${bundle.companies.length}/${baseline.roadmapBaseline.totalCompanies}`);
}
if (bundle.progress.length !== baseline.roadmapBaseline.progressRecords) {
  throw new Error(`Progress record count changed: ${bundle.progress.length}/${baseline.roadmapBaseline.progressRecords}`);
}
if (baseline.approvalPolicy.automaticDeepApprovalAllowed !== false) {
  throw new Error('automaticDeepApprovalAllowed must remain false');
}

console.log('PHASE0_SUMMARY', JSON.stringify({
  deepVerified: report.derived.deepVerified,
  provisionalCandidates: report.derived.provisionalCandidates,
  templateLike: report.derived.templateLike,
  financialStatementReSearch: report.derived.financialStatementReSearch,
  progressRecords: report.derived.progressRecords,
  progressCompanies: report.derived.progressCompanies,
  phase1Selected: report.phase1.selected,
  phase2QueuedAdditional: report.phase2.queuedAdditional,
}));
console.log(JSON.stringify(report, null, 2));
