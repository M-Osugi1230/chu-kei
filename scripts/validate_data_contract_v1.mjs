import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { QUALITY_CHECK_KEYS, QUALITY_PROFILE_VERSION } from './lib/quality_profile_v2.mjs';

const root = path.resolve('.');
const dataDir = path.join(root, 'site', 'data');
const checks = [];
const issues = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  if (!ok) issues.push({ name, detail });
};

const schemaFiles = [
  'schemas/bundle-v1.schema.json',
  'schemas/company-v1.schema.json',
  'schemas/progress-v1.schema.json',
  'schemas/quality-profile-v1.schema.json',
];
for (const file of schemaFiles) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    check(`${file} readable`, true);
  } catch (error) {
    check(`${file} readable`, false, error.message);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'bundle.manifest.json'), 'utf8'));
let data = { companies: [], progress: [] };
try {
  data = JSON.parse(zlib.gunzipSync(Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(dataDir, part.file))),
  )));
  check('bundle readable', true);
} catch (error) {
  check('bundle readable', false, error.message);
}

const companies = data.companies || [];
const progress = data.progress || [];
const markets = new Set(['Prime', 'Standard', 'Growth']);
const stages = new Set(['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed']);
const isoPartial = value => value == null || value === '' || /^\d{4}(-\d{2})?(-\d{2})?$/.test(value);
const isoDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

check('company count contract', companies.length === 570, `actual=${companies.length}`);
check(
  'company required fields',
  companies.every(company => company.code
    && company.name
    && company.market
    && company.industry
    && company.stage
    && company.tier
    && company.lastVerifiedDate
    && Array.isArray(company.themes)
    && typeof company.summary === 'string'
    && company.quality
    && company.flags),
);
check('company code contract', companies.every(company => /^[0-9A-Z]{4}$/.test(String(company.code))));
check('company codes unique', new Set(companies.map(company => String(company.code))).size === companies.length);
check('market enum contract', companies.every(company => markets.has(company.market)));
check('stage enum contract', companies.every(company => stages.has(company.stage)));
check('publication date contract', companies.every(company => isoPartial(company.planPublishedDate)));
check('verification date contract', companies.every(company => isoDay(company.lastVerifiedDate)));
check('legacy date forbidden', companies.every(company => !Object.hasOwn(company, 'date')));
check(
  'themes string array',
  companies.every(company => Array.isArray(company.themes)
    && company.themes.every(theme => typeof theme === 'string')),
);
check(
  `quality profile version ${QUALITY_PROFILE_VERSION}`,
  companies.every(company => company.quality?.version === QUALITY_PROFILE_VERSION),
);
check(
  'quality stars contract',
  companies.every(company => Number.isInteger(company.quality?.stars)
    && company.quality.stars >= 1
    && company.quality.stars <= 5),
);
check(
  'quality score contract',
  companies.every(company => company.quality?.score == null
    || (typeof company.quality.score === 'number'
      && company.quality.score >= 0
      && company.quality.score <= 100)),
);
check(
  'quality label contract',
  companies.every(company => typeof company.quality?.label === 'string'
    && company.quality.label.trim()),
);
check(
  'quality eligibility contract',
  companies.every(company => typeof company.quality?.eligibleForScoring === 'boolean'),
);
check(
  'quality check mask contract',
  companies.every(company => Number.isInteger(company.quality?.checkMask)
    && company.quality.checkMask >= 0
    && company.quality.checkMask < (1 << QUALITY_CHECK_KEYS.length)),
);
check(
  'verbose quality fields forbidden',
  companies.every(company => !Object.hasOwn(company.quality || {}, 'checks')
    && !Object.hasOwn(company.quality || {}, 'reasons')
    && !Object.hasOwn(company.quality || {}, 'missing')),
);
check(
  'coverage score null',
  companies.filter(company => company.stage === 'jpx_indexed').every(company => company.quality.score == null),
);
check(
  'source-confirmed HTTPS',
  companies
    .filter(company => company.stage !== 'jpx_indexed')
    .every(company => typeof company.sourceUrl === 'string' && company.sourceUrl.startsWith('https://')),
);
check(
  'coverage metrics absent',
  companies
    .filter(company => company.stage === 'jpx_indexed')
    .every(company => !company.revenue
      && !company.profit
      && !company.margin
      && !company.capital
      && !company.returnPolicy),
);

const companyCodes = new Set(companies.map(company => String(company.code)));
const keys = new Set();
let duplicate = 0;
let orphan = 0;
let badProgress = 0;
for (const row of progress) {
  if (!/^[0-9A-Z]{4}$/.test(String(row.code))
    || row.fiscalYear == null
    || typeof row.metric !== 'string'
    || !row.metric) badProgress += 1;
  const key = `${row.code}|${row.fiscalYear}|${row.metric}`;
  if (keys.has(key)) duplicate += 1;
  keys.add(key);
  if (!companyCodes.has(String(row.code))) orphan += 1;
}
check('progress count contract', progress.length === 149, `actual=${progress.length}`);
check('progress required fields', badProgress === 0, `invalid=${badProgress}`);
check('progress key unique', duplicate === 0, `duplicates=${duplicate}`);
check('progress company reference', orphan === 0, `orphans=${orphan}`);

const forbidden = ['おすすめ銘柄', '買い推奨', '勝率'];
check('recommendation language forbidden', forbidden.every(term => !JSON.stringify(data).includes(term)));

fs.mkdirSync('artifacts', { recursive: true });
const report = {
  version: 'data-contract-v1',
  checkedAt: new Date().toISOString(),
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  checks,
  issues,
};
fs.writeFileSync('artifacts/data-contract-report-v1.json', `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
}
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
