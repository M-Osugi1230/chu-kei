import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'quality-score-v2-validation.json');
const WEIGHTS = { officialSource: 15, publicationDate: 10, pageEvidence: 15, structuredAnalysis: 15, metricExtraction: 15, progressConnected: 10, humanReviewed: 10, doubleChecked: 10 };
const checks = [];
const issues = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); if (!ok) issues.push({ name, detail }); };

function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return { manifest, data: JSON.parse(zlib.gunzipSync(compressed)) };
}
function expectedScore(profile) {
  return Object.entries(profile.checks || {}).reduce((sum, [key, value]) => sum + (value ? (WEIGHTS[key] || 0) : 0), 0);
}
function expectedStars(company) {
  if (company.stage === 'jpx_indexed') return 1;
  const values = Object.values(company.quality.checks || {});
  const score = expectedScore(company.quality);
  if (values.length === 8 && values.every(Boolean)) return 5;
  if (score >= 65) return 4;
  if (score >= 45) return 3;
  if (company.quality.checks?.officialSource) return 2;
  return 1;
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
check('quality profile version 2.0', companies.every(company => company.quality?.version === '2.0'));
check('quality checks complete', companies.every(company => Object.keys(company.quality?.checks || {}).length === 8));
check('coverage remains one star and unscored', companies.filter(company => company.stage === 'jpx_indexed').every(company => company.quality.stars === 1 && company.quality.score == null && company.quality.eligibleForScoring === false));
check('scored companies have numeric score', companies.filter(company => company.stage !== 'jpx_indexed').every(company => Number.isFinite(company.quality.score) && company.quality.eligibleForScoring === true));
check('quality score matches evidence weights', companies.filter(company => company.stage !== 'jpx_indexed').every(company => company.quality.score === expectedScore(company.quality)));
check('quality stars match thresholds', companies.every(company => company.quality.stars === expectedStars(company)));
check('five stars require every evidence and review check', companies.filter(company => company.quality.stars === 5).every(company => Object.values(company.quality.checks).every(Boolean)));
check('core is not automatically five stars', companies.filter(company => company.stage === 'core' && company.quality.stars === 5).length < 30, `five-star-core=${companies.filter(company => company.stage === 'core' && company.quality.stars === 5).length}`);
check('source-indexed remains two stars', companies.filter(company => company.stage === 'source_indexed').every(company => company.quality.stars === 2));
check('missing checks are explicit', companies.every(company => Array.isArray(company.quality.missing) && company.quality.missing.every(key => company.quality.checks[key] === false)));
check('positive reasons are explicit', companies.every(company => Array.isArray(company.quality.reasons) && company.quality.reasons.length > 0));

const distribution = Object.fromEntries([5, 4, 3, 2, 1].map(stars => [stars, companies.filter(company => company.quality?.stars === stars).length]));
check('quality distribution totals 570', Object.values(distribution).reduce((sum, value) => sum + value, 0) === 570, JSON.stringify(distribution));

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
const report = { version: 'quality-score-v2-validation', checkedAt: new Date().toISOString(), distribution, passed: checks.filter(item => item.ok).length, total: checks.length, allPassed: issues.length === 0, checks, issues };
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
