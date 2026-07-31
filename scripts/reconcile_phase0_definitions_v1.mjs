import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OUTPUT = path.join(ROOT, 'operations', 'quality-rebase', 'phase0-definition-reconciliation-v1.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const text = value => value == null ? '' : String(value).normalize('NFKC').trim();

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA mismatch: ${digest}`);
  return { manifest, bundle: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
}

const TEMPLATE_PATTERNS = [
  /当該公式開示資料の対象期間/u,
  /主要論点として示す/u,
  /\d+ページの一次証跡を登録/u,
  /JPXの企業コード別公式開示資料で/u,
  /対象年度・単位・(?:実績[／/]目標|目標[／/]実績)の区分は原文を参照/u,
  /自動抽出では目標と実績の同一定義/u,
];
const STRICT_EARNINGS_RELEASE = /決算短信/u;
const BROAD_FINANCIAL_RESULTS = /決算短信|決算説明(?:会)?資料|四半期決算|通期決算|決算補足|決算概要|決算関連/u;
const FORMAL_PLAN = /(?:中期|中長期|長期)?経営計画|中期経営戦略|中長期経営戦略|事業計画|経営方針|経営戦略|成長戦略/u;

function companyText(company) {
  return [
    company.document,
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
  ].map(text).filter(Boolean).join('\n');
}

function isTemplateLike(company) {
  const combined = companyText(company);
  return TEMPLATE_PATTERNS.filter(pattern => pattern.test(combined)).length >= 2;
}

function progressCode(row) {
  return text(row.companyCode ?? row.code ?? row.company?.code ?? row.companyId);
}

function statusSnapshot(row) {
  const statusKeys = [
    'status',
    'connectionStatus',
    'assessmentStatus',
    'progressStatus',
    'comparisonStatus',
    'verificationStatus',
    'sourceStatus',
  ];
  return Object.fromEntries(statusKeys
    .filter(key => row[key] != null)
    .map(key => [key, row[key]]));
}

function numericish(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (typeof value !== 'string') return false;
  return /-?\d[\d,.]*/u.test(value);
}

function hasTargetAndActual(row) {
  const targetKeys = ['target', 'targetValue', 'planValue', 'goalValue'];
  const actualKeys = ['actual', 'actualValue', 'resultValue', 'latestValue'];
  const hasTarget = targetKeys.some(key => numericish(row[key]));
  const hasActual = actualKeys.some(key => numericish(row[key]));
  return hasTarget && hasActual;
}

function explicitlyConnected(row) {
  const values = Object.values(statusSnapshot(row)).map(value => text(value).toLowerCase());
  if (values.some(value => /not[_ -]?comparable|not[_ -]?disclosed|unconnected|pending|candidate|review/u.test(value))) return false;
  if (values.some(value => /connected|comparable|verified|approved|complete|completed/u.test(value))) return true;
  return hasTargetAndActual(row);
}

const { manifest, bundle } = readBundle();
const rows = bundle.companies.map(company => {
  const document = text(company.document);
  const templateLike = isTemplateLike(company);
  return {
    code: text(company.code ?? company.companyCode),
    name: text(company.name),
    document,
    templateLike,
    strictEarningsRelease: STRICT_EARNINGS_RELEASE.test(document),
    broadFinancialResults: BROAD_FINANCIAL_RESULTS.test(document),
    formalPlan: FORMAL_PLAN.test(document),
  };
});

const progressKeyFrequency = new Map();
const progressStatusCounts = new Map();
for (const row of bundle.progress) {
  for (const key of Object.keys(row)) progressKeyFrequency.set(key, (progressKeyFrequency.get(key) ?? 0) + 1);
  const snapshot = statusSnapshot(row);
  const key = JSON.stringify(snapshot);
  progressStatusCounts.set(key, (progressStatusCounts.get(key) ?? 0) + 1);
}

const progressAllCodes = new Set(bundle.progress.map(progressCode).filter(Boolean));
const progressConnectedRows = bundle.progress.filter(explicitlyConnected);
const progressConnectedCodes = new Set(progressConnectedRows.map(progressCode).filter(Boolean));

const report = {
  schemaVersion: 'quality-rebase-phase0-definition-reconciliation-v1',
  generatedAt: new Date().toISOString(),
  bundleSha256: manifest.sha256,
  companies: {
    total: rows.length,
    templateLike: rows.filter(row => row.templateLike).length,
    nonTemplatePool: rows.filter(row => !row.templateLike).length,
    strictEarningsRelease: rows.filter(row => row.strictEarningsRelease).length,
    broadFinancialResults: rows.filter(row => row.broadFinancialResults).length,
    formalPlanTitle: rows.filter(row => row.formalPlan).length,
    formalPlanNonTemplate: rows.filter(row => row.formalPlan && !row.templateLike).length,
    strictEarningsReleaseNonTemplate: rows.filter(row => row.strictEarningsRelease && !row.templateLike).length,
  },
  progress: {
    records: bundle.progress.length,
    companiesWithAnyProgressRecord: progressAllCodes.size,
    explicitlyConnectedRecords: progressConnectedRows.length,
    explicitlyConnectedCompanies: progressConnectedCodes.size,
    keyFrequency: Object.fromEntries([...progressKeyFrequency.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    statusCombinations: [...progressStatusCounts.entries()]
      .map(([status, count]) => ({ status: JSON.parse(status), count }))
      .sort((a, b) => b.count - a.count),
    sampleRows: bundle.progress.slice(0, 12),
  },
  interpretation: {
    provisional315Definition: '非テンプレート型の全315社。深掘り確認済みではなく再監査母集団。',
    strictPhase1EligibleDefinition: '正式中計、直近3年、市場比率、証跡・承認条件を満たす処理優先候補。',
    financialStatement610DefinitionCandidate: '資料名に「決算短信」を含む企業。決算説明資料等を含む広義件数とは分離する。',
    progress72DefinitionCandidate: '進捗レコードがある企業ではなく、目標と実績が比較可能な接続済み企業。',
  },
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log('PHASE0_RECONCILIATION', JSON.stringify({
  companies: report.companies,
  progress: {
    records: report.progress.records,
    companiesWithAnyProgressRecord: report.progress.companiesWithAnyProgressRecord,
    explicitlyConnectedRecords: report.progress.explicitlyConnectedRecords,
    explicitlyConnectedCompanies: report.progress.explicitlyConnectedCompanies,
    statusCombinations: report.progress.statusCombinations,
  },
}));
