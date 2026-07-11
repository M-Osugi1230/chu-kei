import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OPERATIONS_DIR = path.join(ROOT, 'operations');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const BUDGET_PATH = path.join(OPERATIONS_DIR, 'quality-debt-budget-v1.json');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'quality-debt-report-v1.json');
const CSV_PATH = path.join(ARTIFACT_DIR, 'quality-debt-items-v1.csv');

const DEFAULT_POLICY = {
  asOfDate: '2026-07-11',
  staleAfterDays: {
    core: 90,
    detailed_extracted: 180,
    source_indexed: 365,
    jpx_indexed: 365,
  },
};

const STAGES = ['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed'];
const METRIC_FIELDS = ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'];
const PLACEHOLDER_RE = /^(?:未確認|未抽出|未特定|確認中|要確認|n\/?a|none|-)+$/i;
const COVERAGE_SUMMARY_PREFIX = '企業探索用。JPXで上場・市場・業種を確認済み';
const SOURCE_INDEXED_REQUIRED_SUMMARY_TERMS = ['一次確認β', '未抽出'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map((part) => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  return { manifest, payload };
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function publicationEarliestDate(value) {
  const text = String(value ?? '');
  if (/^\d{4}$/.test(text)) return new Date(`${text}-01-01T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(text)) return new Date(`${text}-01T00:00:00Z`);
  return parseIsoDate(text);
}

function daysBetween(older, newer) {
  return Math.floor((newer.getTime() - older.getTime()) / 86_400_000);
}

function hasPageEvidence(company) {
  return (company.evidenceRefs ?? []).some((ref) => /(?:p\.?\s*\d|ページ\s*\d)/i.test(String(ref)));
}

function isMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value !== 'string') return Boolean(value);
  const text = value.trim();
  return Boolean(text) && !PLACEHOLDER_RE.test(text);
}

function hasMetricExtraction(company) {
  return METRIC_FIELDS.some((field) => isMeaningfulValue(company[field]));
}

function isPlaceholder(value) {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return !text || PLACEHOLDER_RE.test(text);
}

function hasUnexpectedSourceIndexedAnalysis(company) {
  const allowedThemes = new Set([
    String(company.industry ?? '').trim(),
    '公式IR起点確認',
    '詳細抽出前',
  ]);
  const unexpectedThemes = (company.themes ?? []).filter((theme) => !allowedThemes.has(String(theme).trim()));
  const summary = String(company.summary ?? '');
  return hasMetricExtraction(company)
    || Boolean(company.highlights?.length)
    || Object.values(company.flags ?? {}).some(Boolean)
    || unexpectedThemes.length > 0
    || !SOURCE_INDEXED_REQUIRED_SUMMARY_TERMS.every((term) => summary.includes(term));
}

function hasUnexpectedCoverageAnalysis(company) {
  const summary = String(company.summary ?? '').trim();
  return hasMetricExtraction(company)
    || Boolean(company.themes?.length)
    || Boolean(company.highlights?.length)
    || Object.values(company.flags ?? {}).some(Boolean)
    || !summary.startsWith(COVERAGE_SUMMARY_PREFIX);
}

function hasValidCoverageSource(company) {
  try {
    const url = new URL(company.sourceUrl);
    return url.protocol === 'https:'
      && url.hostname === 'www2.jpx.co.jp'
      && url.pathname === '/tseHpFront/StockSearch.do'
      && url.searchParams.get('topSearchStr') === String(company.code);
  } catch {
    return false;
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' / ') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

const { manifest, payload } = readBundle();
const companies = payload.companies ?? [];
const budgetFile = fs.existsSync(BUDGET_PATH) ? readJson(BUDGET_PATH) : null;
const policy = budgetFile?.policy ?? DEFAULT_POLICY;
const effectiveAsOfDate = process.env.QUALITY_AS_OF_DATE || policy.asOfDate;
const asOfDate = parseIsoDate(effectiveAsOfDate);
if (!asOfDate) throw new Error(`Invalid quality as-of date: ${effectiveAsOfDate}`);

const items = [];
const counts = {};
function addDebt(company, dimension, detail, severity = 'debt') {
  counts[dimension] = (counts[dimension] ?? 0) + 1;
  items.push({
    severity,
    dimension,
    code: company?.code ?? null,
    name: company?.name ?? null,
    stage: company?.stage ?? null,
    detail,
  });
}

const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, companies.filter((company) => company.stage === stage).length]));

for (const company of companies) {
  const verified = parseIsoDate(company.lastVerifiedDate);
  if (!verified) {
    addDebt(company, 'invalidLastVerifiedDate', String(company.lastVerifiedDate ?? ''), 'structural');
  } else {
    if (verified > asOfDate) addDebt(company, 'futureLastVerifiedDate', company.lastVerifiedDate, 'structural');
    const staleLimit = policy.staleAfterDays?.[company.stage];
    if (Number.isInteger(staleLimit) && daysBetween(verified, asOfDate) > staleLimit) {
      addDebt(company, `${company.stage}.staleVerification`, `${daysBetween(verified, asOfDate)} days > ${staleLimit}`);
    }
  }

  if (company.planPublishedDate) {
    const published = publicationEarliestDate(company.planPublishedDate);
    if (!published || Number.isNaN(published.getTime())) {
      addDebt(company, 'invalidPlanPublishedDate', String(company.planPublishedDate), 'structural');
    } else {
      if (published > asOfDate) addDebt(company, 'futurePlanPublishedDate', company.planPublishedDate, 'structural');
      if (verified && published > verified) {
        addDebt(company, 'publicationAfterVerification', `${company.planPublishedDate} > ${company.lastVerifiedDate}`, 'structural');
      }
    }
  }

  const evidenceRefs = Array.isArray(company.evidenceRefs) ? company.evidenceRefs.map((value) => String(value).trim()) : [];
  const emptyEvidence = evidenceRefs.filter((value) => !value).length;
  if (emptyEvidence) addDebt(company, 'emptyEvidenceRef', `${emptyEvidence} empty references`, 'structural');
  const duplicateEvidence = evidenceRefs.length - new Set(evidenceRefs).size;
  if (duplicateEvidence) addDebt(company, 'duplicateEvidenceRef', `${duplicateEvidence} duplicate references`);

  if (company.stage !== 'jpx_indexed') {
    if (!(typeof company.sourceUrl === 'string' && company.sourceUrl.startsWith('https://'))) {
      addDebt(company, `${company.stage}.missingOfficialSource`, 'sourceUrl missing or not HTTPS', 'structural');
    }
    if (isPlaceholder(company.document)) addDebt(company, `${company.stage}.missingDocumentLabel`, String(company.document ?? ''));
  }

  if (company.stage === 'core') {
    if (!company.planPublishedDate) addDebt(company, 'core.missingPublicationDate', 'planPublishedDate is null');
    if (!hasPageEvidence(company)) addDebt(company, 'core.missingPageEvidence', 'no page-number evidence');
    if (!hasMetricExtraction(company)) addDebt(company, 'core.missingMetricExtraction', 'no metric/policy field');
    if (!company.flags?.progress) addDebt(company, 'core.missingProgressConnection', 'flags.progress is false');
    if (isPlaceholder(company.summary)) addDebt(company, 'core.placeholderSummary', String(company.summary ?? ''));
    if (!evidenceRefs.length) addDebt(company, 'core.noEvidenceRefs', 'evidenceRefs is empty');
    if ((company.quality?.stars ?? 0) < 5) addDebt(company, 'core.notFiveStar', `stars=${company.quality?.stars ?? null}`);
  }

  if (company.stage === 'detailed_extracted') {
    if (!company.planPublishedDate) addDebt(company, 'detailed.missingPublicationDate', 'planPublishedDate is null');
    if (!hasPageEvidence(company)) addDebt(company, 'detailed.missingPageEvidence', 'no page-number evidence');
    if (!hasMetricExtraction(company)) addDebt(company, 'detailed.missingMetricExtraction', 'no metric/policy field');
    if (isPlaceholder(company.summary)) addDebt(company, 'detailed.placeholderSummary', String(company.summary ?? ''));
    if (!evidenceRefs.length) addDebt(company, 'detailed.noEvidenceRefs', 'evidenceRefs is empty');
  }

  if (company.stage === 'source_indexed' && hasUnexpectedSourceIndexedAnalysis(company)) {
    addDebt(company, 'sourceIndexed.unexpectedAnalysis', 'content exceeds official IR starting-point scope', 'structural');
  }

  if (company.stage === 'jpx_indexed') {
    if (hasUnexpectedCoverageAnalysis(company)) {
      addDebt(company, 'coverage.unexpectedAnalysis', 'content exceeds JPX coverage scope', 'structural');
    }
    if (!hasValidCoverageSource(company)) {
      addDebt(company, 'coverage.invalidJpxSource', String(company.sourceUrl ?? ''), 'structural');
    }
    if (company.planPublishedDate) addDebt(company, 'coverage.unexpectedPublicationDate', String(company.planPublishedDate), 'structural');
  }
}

const normalizedUrlGroups = new Map();
for (const company of companies.filter((row) => row.stage !== 'jpx_indexed')) {
  const normalized = normalizeUrl(company.sourceUrl);
  if (!normalized) continue;
  if (!normalizedUrlGroups.has(normalized)) normalizedUrlGroups.set(normalized, []);
  normalizedUrlGroups.get(normalized).push(company);
}
for (const [url, rows] of normalizedUrlGroups.entries()) {
  const codes = new Set(rows.map((row) => row.code));
  if (codes.size > 1) {
    counts.duplicateSourceUrlGroup = (counts.duplicateSourceUrlGroup ?? 0) + 1;
    items.push({ severity: 'debt', dimension: 'duplicateSourceUrlGroup', code: null, name: null, stage: null, detail: `${url} -> ${rows.map((row) => `${row.code}:${row.name}`).join(', ')}` });
  }
}

const summaryGroups = new Map();
for (const company of companies.filter((row) => ['core', 'detailed_extracted'].includes(row.stage))) {
  const summary = String(company.summary ?? '').trim().replace(/\s+/g, ' ');
  if (summary.length < 20 || PLACEHOLDER_RE.test(summary)) continue;
  if (!summaryGroups.has(summary)) summaryGroups.set(summary, []);
  summaryGroups.get(summary).push(company);
}
for (const [summary, rows] of summaryGroups.entries()) {
  const codes = new Set(rows.map((row) => row.code));
  if (codes.size > 1) {
    counts.duplicateStructuredSummaryGroup = (counts.duplicateStructuredSummaryGroup ?? 0) + 1;
    items.push({ severity: 'debt', dimension: 'duplicateStructuredSummaryGroup', code: null, name: null, stage: null, detail: `${rows.map((row) => `${row.code}:${row.name}`).join(', ')} | ${summary.slice(0, 120)}` });
  }
}

const normalizedCounts = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const structuralDimensions = new Set(items.filter((item) => item.severity === 'structural').map((item) => item.dimension));
const budget = budgetFile?.maximumCounts ?? null;
const regressions = [];
const improvements = [];

if (budget) {
  const dimensions = new Set([...Object.keys(budget), ...Object.keys(normalizedCounts)]);
  for (const dimension of [...dimensions].sort()) {
    const actual = normalizedCounts[dimension] ?? 0;
    const maximum = budget[dimension] ?? 0;
    if (actual > maximum) regressions.push({ dimension, actual, maximum, increase: actual - maximum });
    if (actual < maximum) improvements.push({ dimension, actual, maximum, decrease: maximum - actual });
  }
}

const affectedCodes = new Set(items.map((item) => item.code).filter(Boolean));
const affectedByStage = Object.fromEntries(STAGES.map((stage) => [stage, new Set(items.filter((item) => item.stage === stage).map((item) => item.code).filter(Boolean)).size]));
const report = {
  version: 'quality-debt-budget-v1',
  generatedAt: new Date().toISOString(),
  bundle: {
    version: manifest.version,
    sha256: manifest.sha256,
    companyCount: companies.length,
    stageCounts,
  },
  policy: { ...policy, effectiveAsOfDate },
  budgetMode: budget ? 'enforced' : 'bootstrap',
  debtCounts: normalizedCounts,
  totalDebtItems: items.length,
  affectedCompanies: affectedCodes.size,
  affectedByStage,
  structuralDimensions: [...structuralDimensions].sort(),
  regressions,
  improvements,
  passed: structuralDimensions.size === 0 && regressions.length === 0,
  items,
};

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
const headers = ['severity', 'dimension', 'code', 'name', 'stage', 'detail'];
const lines = [headers.map(csvCell).join(',')];
for (const item of items) lines.push(headers.map((header) => csvCell(item[header])).join(','));
fs.writeFileSync(CSV_PATH, `${lines.join('\n')}\n`);

console.log(JSON.stringify({
  budgetMode: report.budgetMode,
  effectiveAsOfDate,
  totalDebtItems: report.totalDebtItems,
  affectedCompanies: report.affectedCompanies,
  affectedByStage,
  debtCounts: report.debtCounts,
  regressions,
  improvements,
}, null, 2));
console.log(`Report: ${REPORT_PATH}`);
console.log(`Items: ${CSV_PATH}`);

if (structuralDimensions.size > 0) {
  console.error(`Structural quality errors: ${[...structuralDimensions].join(', ')}`);
  process.exit(1);
}
if (regressions.length > 0) {
  console.error(`Quality debt budget exceeded in ${regressions.length} dimensions.`);
  process.exit(1);
}
