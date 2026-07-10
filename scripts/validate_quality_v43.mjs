import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const allowMissing = args.has('--allow-missing');
const rootArg = process.argv.find((value) => value.startsWith('--root='));
const root = path.resolve(rootArg ? rootArg.slice('--root='.length) : 'site');
const dataDir = path.join(root, 'data');
const reportDir = path.resolve('artifacts');
const reportPath = path.join(reportDir, 'quality-report-v43.json');

const checks = [];
const issues = [];

function addCheck(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) issues.push({ name, detail });
}

function readJson(fileName, required = true) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) {
    if (required) addCheck(`${fileName} exists`, false, filePath);
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    addCheck(`${fileName} JSON syntax`, true);
    return value;
  } catch (error) {
    addCheck(`${fileName} JSON syntax`, false, error.message);
    return null;
  }
}

function normalizedDate(company) {
  return company.planPublishedDate ?? company.date ?? null;
}

function verifiedDate(company) {
  return company.lastVerifiedDate ?? company.sourceVerifiedAt ?? null;
}

function isIsoDate(value) {
  return value == null || value === '' || /^\d{4}(-\d{2})?(-\d{2})?$/.test(value);
}

function validHttps(value) {
  return typeof value === 'string' && value.startsWith('https://');
}

function companyStage(company, isCore) {
  if (company.reviewStage) return company.reviewStage;
  if (isCore) return 'core';
  if (company.extractionStatus === 'beta_verified') return 'detailed_extracted';
  if (company.extractionStatus === 'source_indexed') return 'source_indexed';
  if (company.extractionStatus === 'jpx_indexed') return 'jpx_indexed';
  return 'unknown';
}

if (!fs.existsSync(dataDir)) {
  const detail = `Data directory not found: ${dataDir}`;
  addCheck('site data directory', allowMissing, detail);
  fs.mkdirSync(reportDir, { recursive: true });
  const report = {
    version: 'v43-foundation',
    checkedAt: new Date().toISOString(),
    root,
    bootstrapMode: allowMissing,
    passed: checks.filter((check) => check.ok).length,
    total: checks.length,
    allPassed: issues.length === 0,
    checks,
    issues,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(issues.length === 0 ? 0 : 1);
}

const core = readJson('sample_companies.json') ?? [];
const beta = readJson('beta_companies.json') ?? [];
const progress = readJson('plan_progress.json') ?? [];
const metadata = readJson('release_metadata.json') ?? {};
const qualitySummary = readJson('data_quality_summary.json', false);
const qualityAudit = readJson('data_quality_audit.json', false);

addCheck('core companies array', Array.isArray(core), `type=${typeof core}`);
addCheck('beta companies array', Array.isArray(beta), `type=${typeof beta}`);
addCheck('progress rows array', Array.isArray(progress), `type=${typeof progress}`);

const companies = [
  ...(Array.isArray(core) ? core.map((company) => ({ ...company, __core: true })) : []),
  ...(Array.isArray(beta) ? beta.map((company) => ({ ...company, __core: false })) : []),
];

addCheck('company total 570', companies.length === 570, `actual=${companies.length}`);
addCheck('core company total 30', core.length === 30, `actual=${core.length}`);
addCheck('beta company total 540', beta.length === 540, `actual=${beta.length}`);

const codes = companies.map((company) => String(company.code ?? '').trim());
const uniqueCodes = new Set(codes);
addCheck('security codes unique', uniqueCodes.size === codes.length, `unique=${uniqueCodes.size}, total=${codes.length}`);
addCheck('security code format', codes.every((code) => /^[0-9A-Z]{4}$/.test(code)), 'expected four uppercase alphanumeric characters');
addCheck('company names present', companies.every((company) => typeof company.name === 'string' && company.name.trim()), '');
addCheck('market values valid', companies.every((company) => ['Prime', 'Standard', 'Growth'].includes(company.market)), '');
addCheck('industry present', companies.every((company) => typeof company.industry === 'string' && company.industry.trim()), '');

const stageCounts = companies.reduce((counts, company) => {
  const stage = companyStage(company, company.__core);
  counts[stage] = (counts[stage] ?? 0) + 1;
  return counts;
}, {});
addCheck(
  'quality stage counts',
  stageCounts.core === 30 && stageCounts.detailed_extracted === 70 && stageCounts.source_indexed === 100 && stageCounts.jpx_indexed === 370,
  JSON.stringify(stageCounts),
);

const sourceConfirmed = companies.filter((company) => ['core', 'detailed_extracted', 'source_indexed'].includes(companyStage(company, company.__core)));
const coverageOnly = companies.filter((company) => companyStage(company, company.__core) === 'jpx_indexed');
addCheck('source-confirmed total 200', sourceConfirmed.length === 200, `actual=${sourceConfirmed.length}`);
addCheck('coverage-only total 370', coverageOnly.length === 370, `actual=${coverageOnly.length}`);
addCheck('source-confirmed HTTPS URLs', sourceConfirmed.every((company) => validHttps(company.sourceUrl)), '');
addCheck('publication date format', companies.every((company) => isIsoDate(normalizedDate(company))), '');
addCheck('verification date format', companies.every((company) => isIsoDate(verifiedDate(company))), '');
addCheck(
  'date semantics separated where v43 fields exist',
  companies.every((company) => !('planPublishedDate' in company && 'lastVerifiedDate' in company) || company.planPublishedDate !== company.lastVerifiedDate || company.datePrecision === 'confirmed_same_day'),
  'identical dates require an explicit confirmed_same_day marker',
);

addCheck(
  'coverage-only has no fabricated analysis',
  coverageOnly.every((company) => {
    const forbidden = [company.summary, company.revenue, company.profit, company.margin, company.capital, company.returnPolicy]
      .filter((value) => typeof value === 'string')
      .join(' ');
    return !forbidden || /未抽出|未特定|確認前|登録待ち|企業探索用/.test(forbidden);
  }),
  '',
);

const companyCodeSet = new Set(codes);
const progressKeys = new Set();
let orphanProgress = 0;
let duplicateProgress = 0;
let inconsistentProgress = 0;
for (const row of progress) {
  const key = [row.code, row.fiscalYear, row.metric].join('|');
  if (progressKeys.has(key)) duplicateProgress += 1;
  progressKeys.add(key);
  if (!companyCodeSet.has(String(row.code))) orphanProgress += 1;
  if (Number.isFinite(row.targetValue) && Number.isFinite(row.actualValue) && row.targetValue !== 0 && Number.isFinite(row.progressRate)) {
    const calculated = Math.round((row.actualValue / row.targetValue) * 1000) / 10;
    if (Math.abs(calculated - row.progressRate) > 0.1) inconsistentProgress += 1;
  }
}
addCheck('progress row total 149', progress.length === 149, `actual=${progress.length}`);
addCheck('progress keys unique', duplicateProgress === 0, `duplicates=${duplicateProgress}`);
addCheck('no orphan progress rows', orphanProgress === 0, `orphans=${orphanProgress}`);
addCheck('progress calculations consistent', inconsistentProgress === 0, `inconsistent=${inconsistentProgress}`);

addCheck('metadata product', metadata.product === 'Chu-kei', `actual=${metadata.product}`);
addCheck('metadata total company count', metadata.totalCompanyCount === 570, `actual=${metadata.totalCompanyCount}`);
addCheck('metadata coverage count', metadata.coverageBetaCompanyCount === 370, `actual=${metadata.coverageBetaCompanyCount}`);
addCheck('metadata core count', metadata.coreCompanyCount === 30, `actual=${metadata.coreCompanyCount}`);
addCheck('quality summary readable when present', qualitySummary == null || typeof qualitySummary === 'object', '');
addCheck('quality audit readable when present', qualityAudit == null || typeof qualityAudit === 'object', '');

const forbiddenInvestmentTerms = ['おすすめ銘柄', '買い推奨', '勝率'];
const searchableText = JSON.stringify({ companies, metadata });
addCheck(
  'no investment recommendation language',
  forbiddenInvestmentTerms.every((term) => !searchableText.includes(term)),
  forbiddenInvestmentTerms.filter((term) => searchableText.includes(term)).join(', '),
);

fs.mkdirSync(reportDir, { recursive: true });
const report = {
  version: 'v43-foundation',
  checkedAt: new Date().toISOString(),
  root,
  bootstrapMode: false,
  passed: checks.filter((check) => check.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  stageCounts,
  checks,
  issues,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}`);
}
console.log(`\n${report.passed}/${report.total} checks passed`);
console.log(`Report: ${reportPath}`);
process.exit(report.allPassed ? 0 : 1);
