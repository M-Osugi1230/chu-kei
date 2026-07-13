import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  QUALITY_CHECK_KEYS,
  QUALITY_PROFILE_VERSION,
  buildQualityChecks,
  buildQualityProfile,
  checksToMask,
} from './lib/quality_profile_v2.mjs';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'quality-score-v2-validation.json');
const checks = [];
const issues = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  if (!ok) issues.push({ name, detail });
};

function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return { manifest, data: JSON.parse(zlib.gunzipSync(compressed)) };
}

let manifest = {};
let data = { companies: [] };
try {
  ({ manifest, data } = readBundle());
  check('quality score bundle readable', true);
} catch (error) {
  check('quality score bundle readable', false, error.message);
}

const companies = data.companies || [];
check('quality score manifest version', manifest.version === 'v43-quality-score-v2', `actual=${manifest.version}`);
check(
  `quality profile version ${QUALITY_PROFILE_VERSION}`,
  companies.every(company => company.quality?.version === QUALITY_PROFILE_VERSION),
);
check(
  'quality check mask contract',
  companies.every(company => Number.isInteger(company.quality?.checkMask)
    && company.quality.checkMask >= 0
    && company.quality.checkMask < (1 << QUALITY_CHECK_KEYS.length)),
);
check(
  'verbose quality fields removed',
  companies.every(company => !Object.hasOwn(company.quality || {}, 'checks')
    && !Object.hasOwn(company.quality || {}, 'reasons')
    && !Object.hasOwn(company.quality || {}, 'missing')),
);
check(
  'coverage remains one star and unscored',
  companies
    .filter(company => company.stage === 'jpx_indexed')
    .every(company => company.quality.stars === 1
      && company.quality.score == null
      && company.quality.eligibleForScoring === false),
);
check(
  'scored companies have numeric score',
  companies
    .filter(company => company.stage !== 'jpx_indexed')
    .every(company => Number.isFinite(company.quality.score)
      && company.quality.eligibleForScoring === true),
);
check(
  'quality check mask matches source fields',
  companies.every(company => company.quality.checkMask === checksToMask(buildQualityChecks(company))),
);
check(
  'quality score matches source fields',
  companies.every(company => company.quality.score === buildQualityProfile(company).score),
);
check(
  'quality stars match thresholds',
  companies.every(company => company.quality.stars === buildQualityProfile(company).stars),
);
check(
  'quality label matches stage and evidence',
  companies.every(company => company.quality.label === buildQualityProfile(company).label),
);
check(
  'five stars require every evidence and review check',
  companies
    .filter(company => company.quality.stars === 5)
    .every(company => company.quality.checkMask === (1 << QUALITY_CHECK_KEYS.length) - 1),
);
check(
  'core is not automatically five stars',
  companies.filter(company => company.stage === 'core' && company.quality.stars === 5).length < 30,
  `five-star-core=${companies.filter(company => company.stage === 'core' && company.quality.stars === 5).length}`,
);
check(
  'source-indexed remains two stars',
  companies.filter(company => company.stage === 'source_indexed').every(company => company.quality.stars === 2),
);

const distribution = Object.fromEntries(
  [5, 4, 3, 2, 1].map(stars => [
    stars,
    companies.filter(company => company.quality?.stars === stars).length,
  ]),
);
check(
  'quality distribution totals company count',
  Object.values(distribution).reduce((sum, value) => sum + value, 0) === companies.length,
  JSON.stringify(distribution),
);

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
const report = {
  version: 'quality-score-v2-validation',
  checkedAt: new Date().toISOString(),
  profileVersion: QUALITY_PROFILE_VERSION,
  distribution,
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  checks,
  issues,
};
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
}
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
