import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = path.resolve('.');
const SITE_DATA = path.join(ROOT, 'site', 'data');
const UNIVERSE_PATH = path.join(ROOT, 'operations', 'universe', 'current-universe-v1.json');
const PLAN_REGISTRY_PATH = path.join(ROOT, 'operations', 'plan-detection', 'registry-v1.json');
const SOURCE_MANIFEST_PATH = path.join(SITE_DATA, 'bundle.manifest.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research-priority', 'current-v1.json');
const PUBLIC_SUMMARY_PATH = path.join(SITE_DATA, 'research-priority-summary-v1.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  const text = String(value).trim();
  return Boolean(text) && text !== '未抽出' && !text.startsWith('未抽出');
}

function readSourceBundle() {
  const manifest = readJson(SOURCE_MANIFEST_PATH);
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(SITE_DATA, part.file))),
  );
  if (sha256(compressed) !== manifest.sha256) throw new Error('Source bundle SHA-256 mismatch');
  const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  if (!Array.isArray(bundle.companies)) throw new Error('Source bundle companies must be an array');
  return { manifest, bundle };
}

function progressCompanyCode(row) {
  const value = row?.code ?? row?.companyCode ?? row?.ticker ?? row?.securityCode ?? null;
  return value === null || value === undefined ? null : String(value).toUpperCase();
}

function sourceCandidateHints(company) {
  if (!company) return { score: 0, hints: [] };
  const hints = [];
  const document = String(company.document || '');
  const titleLooksPlanLike = /(中期|中長期|経営計画|事業計画|成長可能性|mid.?term|management plan|business plan|vision)/i.test(document);
  if (titleLooksPlanLike) hints.push('plan_like_document_title');
  if (hasValue(company.sourceUrl)) hints.push('source_url_present');
  if (hasValue(company.planPublishedDate)) hints.push('plan_published_date_present');
  if (Array.isArray(company.evidenceRefs) && company.evidenceRefs.length > 0) hints.push('evidence_refs_present');
  if (['core', 'detailed_extracted', 'source_indexed'].includes(company.stage)) hints.push('existing_structured_record');

  const score =
    (titleLooksPlanLike ? 40 : 0)
    + (hasValue(company.sourceUrl) ? 20 : 0)
    + (hasValue(company.planPublishedDate) ? 15 : 0)
    + (Array.isArray(company.evidenceRefs) && company.evidenceRefs.length > 0 ? 15 : 0)
    + (['core', 'detailed_extracted'].includes(company.stage) ? 10 : 0);

  return { score, hints };
}

const CORE_FIELDS = [
  { key: 'period', label: '計画期間', weight: 5, test: company => hasValue(company?.period) },
  { key: 'revenue', label: '売上目標', weight: 4, test: company => hasValue(company?.revenue) },
  { key: 'profit', label: '利益目標', weight: 5, test: company => hasValue(company?.profit) },
  { key: 'margin', label: '収益性', weight: 3, test: company => hasValue(company?.margin) },
  { key: 'capital', label: '資本効率', weight: 4, test: company => hasValue(company?.capital) },
  { key: 'returnPolicy', label: '株主還元', weight: 3, test: company => hasValue(company?.returnPolicy) },
  { key: 'strategy', label: '成長戦略', weight: 4, test: company => Array.isArray(company?.themes) && company.themes.length > 0 },
  { key: 'evidence', label: '公式根拠', weight: 5, test: (_company, context) => hasValue(context?.planReviewSourceUrl) },
  { key: 'progress', label: '最新進捗', weight: 3, test: (_company, context) => context?.hasProgress === true },
];

const universe = readJson(UNIVERSE_PATH);
const planRegistry = readJson(PLAN_REGISTRY_PATH);
if (universe.version !== 'company-universe-v1' || !Array.isArray(universe.companies)) {
  throw new Error('Unsupported company universe format');
}
if (planRegistry.version !== 'plan-detection-registry-v1' || !Array.isArray(planRegistry.companies)) {
  throw new Error('Unsupported plan detection registry format');
}

const { manifest: sourceManifest, bundle: sourceBundle } = readSourceBundle();
const sourceByCode = new Map(sourceBundle.companies.map(company => [String(company.code).toUpperCase(), company]));
const planByCode = new Map(planRegistry.companies.map(company => [String(company.code).toUpperCase(), company]));
const progressCodes = new Set(
  (sourceBundle.progress || [])
    .map(progressCompanyCode)
    .filter(Boolean),
);

const l1 = [];
const l2 = [];
const noCurrentCoreRequired = [];
const totalCoreWeight = CORE_FIELDS.reduce((sum, field) => sum + field.weight, 0);

for (const listing of universe.companies) {
  const code = String(listing.code).toUpperCase();
  const plan = planByCode.get(code);
  if (!plan) throw new Error(`Plan detection record missing for ${code}`);

  const sourceCompany = sourceByCode.get(code) || null;
  const candidate = sourceCandidateHints(sourceCompany);

  if (plan.status === 'not_checked') {
    l1.push({
      layer: 'L1_PLAN_DETECTION',
      code,
      name: listing.name,
      market: listing.market,
      industry: listing.industry,
      priorityBand: 'P0',
      priorityScore: 1000 + candidate.score,
      candidateHintScore: candidate.score,
      candidateHints: candidate.hints,
      researchTask: '一次情報で現行中計・過去中計・正式中計なし・未構造化のいずれかを確認する',
      completionRequires: ['checkedAt', 'sourceUrl', 'explicit_status'],
    });
    continue;
  }

  if (plan.status === 'no_formal_plan' || plan.status === 'expired') {
    noCurrentCoreRequired.push({
      code,
      name: listing.name,
      status: plan.status,
      checkedAt: plan.review?.checkedAt || null,
    });
    continue;
  }

  if (plan.status !== 'current' && plan.status !== 'found_unstructured') continue;

  const context = {
    planReviewSourceUrl: plan.review?.sourceUrl || null,
    hasProgress: progressCodes.has(code),
  };
  const missingFields = [];
  const availableFields = [];
  let availableWeight = 0;

  for (const field of CORE_FIELDS) {
    if (field.test(sourceCompany, context)) {
      availableFields.push(field.key);
      availableWeight += field.weight;
    } else {
      missingFields.push({
        key: field.key,
        label: field.label,
        impactWeight: field.weight,
      });
    }
  }

  const gapImpactScore = totalCoreWeight - availableWeight;
  const comparisonReadiness = totalCoreWeight
    ? Number((availableWeight / totalCoreWeight).toFixed(4))
    : 0;

  if (missingFields.length > 0) {
    l2.push({
      layer: 'L2_COMPARISON_CORE',
      code,
      name: listing.name,
      market: listing.market,
      industry: listing.industry,
      planStatus: plan.status,
      priorityBand: 'P1',
      priorityScore: 500 + gapImpactScore,
      comparisonReadiness,
      availableFields,
      missingFields,
      researchTask: '比較を成立させるCore欠損だけを一次情報から補完する',
    });
  }
}

l1.sort((a, b) =>
  b.priorityScore - a.priorityScore
  || a.market.localeCompare(b.market, 'ja')
  || a.code.localeCompare(b.code, 'ja')
);
l2.sort((a, b) =>
  b.priorityScore - a.priorityScore
  || a.comparisonReadiness - b.comparisonReadiness
  || a.code.localeCompare(b.code, 'ja')
);

const currentPlanCount = planRegistry.companies.filter(company =>
  ['current', 'found_unstructured'].includes(company.status)
).length;
const resolvedPlanCount = planRegistry.companies.filter(company => company.status !== 'not_checked').length;
const l1CandidateHintedCount = l1.filter(item => item.candidateHintScore > 0).length;

const output = {
  version: 'chu-kei-research-priority-v1',
  generatedAt: new Date().toISOString(),
  universeGeneratedAt: universe.generatedAt || null,
  sourceBundleSha256: sourceManifest.sha256,
  policy: {
    productGoal: '企業数の網羅性を維持しながら、企業発見・比較能力を最大化する',
    priorityOrder: [
      'L1_PLAN_DETECTION',
      'L2_COMPARISON_CORE',
      'FRESHNESS',
      'EVIDENCE_REPAIR',
      'L3_DEEP_RESEARCH_ON_DEMAND',
    ],
    planDetectionRule: '候補ヒントは優先順位にだけ使い、中計状態を自動確定しない',
    deepResearchRule: 'L3はユーザー需要または明示された調査目的がある場合のみ起票する',
  },
  counts: {
    universe: universe.companies.length,
    sourceBundleCompanies: sourceBundle.companies.length,
    planResolved: resolvedPlanCount,
    planPending: l1.length,
    planCandidateHinted: l1CandidateHintedCount,
    currentOrUnstructuredPlan: currentPlanCount,
    comparisonCoreQueued: l2.length,
    noCurrentCoreRequired: noCurrentCoreRequired.length,
  },
  comparisonCoreDefinition: CORE_FIELDS.map(({ key, label, weight }) => ({ key, label, weight })),
  queues: {
    planDetection: l1,
    comparisonCore: l2,
  },
  excludedFromCurrentCore: noCurrentCoreRequired,
};

const summary = {
  version: 'chu-kei-research-priority-summary-v1',
  generatedAt: output.generatedAt,
  universeGeneratedAt: output.universeGeneratedAt,
  counts: output.counts,
  nextAction: l1.length > 0
    ? 'Plan Detectionを一次情報で進める。候補ヒントの多い企業から処理する。'
    : l2.length > 0
      ? 'Comparison Core欠損をimpactWeight順に補完する。'
      : 'Coverage/Coreの主要キューは空。Freshnessと需要起点Deep Researchへ進む。',
};

writeJson(OUTPUT_PATH, output);
writeJson(PUBLIC_SUMMARY_PATH, summary);

console.log(JSON.stringify(summary, null, 2));
