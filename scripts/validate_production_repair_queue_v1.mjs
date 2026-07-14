import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const MILESTONE_PATH = path.join(ROOT, 'operations', 'quality', 'coverage-milestone-v1.json');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'production-repair-queue-validation-v1.json');
const checks = [];
const issues = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); if (!ok) issues.push({ name, detail }); };

function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return JSON.parse(zlib.gunzipSync(compressed));
}
function hasPageEvidence(company) {
  return (company.evidenceRefs || []).some(ref => /(?:p\.?\s*\d|ページ\s*\d)/i.test(String(ref)));
}
function hasMetricExtraction(company) {
  return ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'].some(key => Boolean(company[key]));
}
function gaps(company) {
  const values = [];
  if (!(typeof company.sourceUrl === 'string' && company.sourceUrl.startsWith('https://'))) values.push('officialSource');
  if (!company.planPublishedDate) values.push('publicationDate');
  if (!hasPageEvidence(company)) values.push('pageEvidence');
  if (!hasMetricExtraction(company)) values.push('metricExtraction');
  if (!company.flags?.progress) values.push('progressConnected');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(company.lastVerifiedDate || '')) values.push('lastVerifiedDate');
  return values;
}
function priority(values) {
  if (values.includes('officialSource') || values.includes('lastVerifiedDate')) return 'P0';
  if (values.includes('publicationDate')) return 'P1';
  if (values.includes('pageEvidence')) return 'P2';
  if (values.includes('metricExtraction') || values.includes('progressConnected')) return 'P3';
  return 'P4';
}

let data = { companies: [] };
try {
  data = readBundle();
  check('production source bundle readable', true);
} catch (error) {
  check('production source bundle readable', false, error.message);
}
let queueReport = { items: [], summary: {} };
try {
  queueReport = JSON.parse(fs.readFileSync(path.join(ARTIFACT_DIR, 'production-repair-queue-v1.json'), 'utf8'));
  check('production repair queue JSON readable', true);
} catch (error) {
  check('production repair queue JSON readable', false, error.message);
}
const milestone = JSON.parse(fs.readFileSync(MILESTONE_PATH, 'utf8'));
check('production repair queue CSV exists', fs.existsSync(path.join(ARTIFACT_DIR, 'production-repair-queue-v1.csv')));

const core = data.companies.filter(company => company.stage === 'core');
const expected = core.map(company => ({ code: company.code, gaps: gaps(company), priority: priority(gaps(company)), stars: company.quality?.stars })).filter(item => item.gaps.length > 0);
const actual = queueReport.items || [];
check(`core company total matches milestone ${milestone.expectedCore}`, core.length === milestone.expectedCore, `actual=${core.length}`);
check('repair queue contains every incomplete core company', actual.length === expected.length, `actual=${actual.length}, expected=${expected.length}`);
check('repair queue codes unique', new Set(actual.map(item => item.code)).size === actual.length);
check('repair queue contains only core companies', actual.every(item => core.some(company => company.code === item.code)));
check('repair queue gaps match source data', actual.every(item => {
  const exp = expected.find(value => value.code === item.code);
  return exp && JSON.stringify([...item.gaps].sort()) === JSON.stringify([...exp.gaps].sort());
}));
check('repair queue priorities match policy', actual.every(item => {
  const exp = expected.find(value => value.code === item.code);
  return exp && item.priority === exp.priority;
}));
check('five-star core excluded from repair queue', actual.every(item => item.qualityStars !== 5));
check('all non-five-star core records are queued', core.filter(company => company.quality?.stars !== 5).every(company => actual.some(item => item.code === company.code)));
check('summary core count matches milestone', queueReport.summary?.coreCompanies === milestone.expectedCore, `summary=${queueReport.summary?.coreCompanies}`);
check('summary queue count matches items', queueReport.summary?.repairQueue === actual.length);
check('summary gap counts are dynamic', Number.isInteger(queueReport.summary?.publicationDateMissing) && Number.isInteger(queueReport.summary?.pageEvidenceMissing) && Number.isInteger(queueReport.summary?.progressMissing));
check('no company or plan recommendation language', !['おすすめ銘柄', '買い推奨', '勝率'].some(term => JSON.stringify(queueReport).includes(term)));

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const report = { version: 'production-repair-queue-validation-v1', checkedAt: new Date().toISOString(), milestoneCore: milestone.expectedCore, summary: queueReport.summary, passed: checks.filter(item => item.ok).length, total: checks.length, allPassed: issues.length === 0, checks, issues };
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
