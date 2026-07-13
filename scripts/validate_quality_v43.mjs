import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const projectRoot = path.resolve('.');
const siteRoot = path.join(projectRoot, 'site');
const dataDir = path.join(siteRoot, 'data');
const milestonePath = path.join(projectRoot, 'operations', 'quality', 'coverage-milestone-v1.json');
const checks = [];
const issues = [];

const defaultMilestone = {
  schemaVersion: 'coverage-milestone-v1',
  companyTotal: 570,
  progressRows: 149,
  expectedCore: 30,
  minimumSourceConfirmed: 200,
  minimumStructured: 200,
  maximumCoverageBeta: 370,
  absoluteBundleBudgetBytes: 131072,
};

const milestone = fs.existsSync(milestonePath)
  ? JSON.parse(fs.readFileSync(milestonePath, 'utf8'))
  : defaultMilestone;

if (milestone.schemaVersion !== 'coverage-milestone-v1') {
  throw new Error(`Unsupported coverage milestone schema: ${milestone.schemaVersion}`);
}

const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  if (!ok) issues.push({ name, detail });
};

const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'bundle.manifest.json'), 'utf8'));
const buffers = manifest.parts.map(part => fs.readFileSync(path.join(dataDir, part.file)));
const compressed = Buffer.concat(buffers);
const sha = crypto.createHash('sha256').update(compressed).digest('hex');

check('bundle part count', buffers.length === 43, `actual=${buffers.length}`);
check('bundle compressed bytes', compressed.length === manifest.compressedBytes, `actual=${compressed.length}`);
check('bundle absolute budget', compressed.length <= milestone.absoluteBundleBudgetBytes, `actual=${compressed.length}, budget=${milestone.absoluteBundleBudgetBytes}`);
check('bundle SHA-256', sha === manifest.sha256, sha);

let payload = { companies: [], progress: [] };
try {
  payload = JSON.parse(zlib.gunzipSync(compressed));
  check('gzip and JSON readable', true);
} catch (error) {
  check('gzip and JSON readable', false, error.message);
}

const companies = payload.companies || [];
const progress = payload.progress || [];
check(`company total ${milestone.companyTotal}`, companies.length === milestone.companyTotal, `actual=${companies.length}`);
check(`progress rows ${milestone.progressRows}`, progress.length === milestone.progressRows, `actual=${progress.length}`);

const stageNames = ['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed'];
const stages = Object.fromEntries(
  stageNames.map(stage => [stage, companies.filter(company => company.stage === stage).length]),
);
const stageTotal = Object.values(stages).reduce((sum, count) => sum + count, 0);
check(
  'quality stage totals',
  stages.core === milestone.expectedCore
    && stages.jpx_indexed <= milestone.maximumCoverageBeta
    && stageTotal === milestone.companyTotal,
  JSON.stringify(stages),
);

const codes = companies.map(company => String(company.code));
check('security codes unique', new Set(codes).size === milestone.companyTotal);
check('security code format', codes.every(code => /^[0-9A-Z]{4}$/.test(code)));
check('company names present', companies.every(company => company.name));
check('market values valid', companies.every(company => ['Prime', 'Standard', 'Growth'].includes(company.market)));

const sourceConfirmed = companies.filter(company => company.stage !== 'jpx_indexed').length;
const structured = companies.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length;
check(
  `source confirmed minimum ${milestone.minimumSourceConfirmed}`,
  sourceConfirmed >= milestone.minimumSourceConfirmed,
  `actual=${sourceConfirmed}`,
);
check(
  `structured minimum ${milestone.minimumStructured}`,
  structured >= milestone.minimumStructured,
  `actual=${structured}`,
);
check(
  'source URLs valid',
  companies
    .filter(company => company.stage !== 'jpx_indexed')
    .every(company => String(company.sourceUrl || '').startsWith('https://')),
);

check('legacy date removed', companies.every(company => !('date' in company)));
check(
  'date semantics present',
  companies.every(company => (
    'lastVerifiedDate' in company
    && (company.stage === 'jpx_indexed' ? company.planPublishedDate == null : 'planPublishedDate' in company)
  )),
  'Coverageβでは省略をnullとして扱う',
);
check('quality profile present', companies.every(company => company.quality && 'stars' in company.quality));
check(
  'coverage not scored',
  companies.filter(company => company.stage === 'jpx_indexed').every(company => company.quality.score == null),
);
check(
  'coverage has no fabricated metrics',
  companies
    .filter(company => company.stage === 'jpx_indexed')
    .every(company => !company.revenue && !company.profit && !company.margin && !company.capital && !company.returnPolicy),
);

const companySet = new Set(codes);
const progressKeys = new Set();
let duplicates = 0;
let orphans = 0;
for (const row of progress) {
  const key = `${row.code}|${row.fiscalYear}|${row.metric}`;
  if (progressKeys.has(key)) duplicates += 1;
  progressKeys.add(key);
  if (!companySet.has(String(row.code))) orphans += 1;
}
check('progress keys unique', duplicates === 0, `duplicates=${duplicates}`);
check('no orphan progress', orphans === 0, `orphans=${orphans}`);

const forbidden = ['おすすめ銘柄', '買い推奨', '勝率'];
const text = JSON.stringify(payload);
check(
  'no recommendation language',
  forbidden.every(term => !text.includes(term)),
  forbidden.filter(term => text.includes(term)).join(','),
);

for (const file of [
  'index.html',
  'assets/app.js',
  'assets/styles.css',
  '404.html',
  'manifest.webmanifest',
  'robots.txt',
  '_headers',
]) {
  check(`${file} exists`, fs.existsSync(path.join(siteRoot, file)));
}

fs.mkdirSync(path.join(projectRoot, 'artifacts'), { recursive: true });
const report = {
  version: 'v43-milestone-aware',
  checkedAt: new Date().toISOString(),
  milestone,
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  stages,
  sourceConfirmed,
  structured,
  checks,
  issues,
};
fs.writeFileSync(
  path.join(projectRoot, 'artifacts', 'quality-report-v43.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
}
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
