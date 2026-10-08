import fs from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_STATUSES,
  RESOLVED_STATUSES,
  extractEndDates,
  resolveCompanyStatus,
} from './lib/plan_detection_v1.mjs';

const ROOT = path.resolve('.');
const UNIVERSE_PATH = path.join(ROOT, 'operations', 'universe', 'current-universe-v1.json');
const REGISTRY_PATH = path.join(ROOT, 'operations', 'plan-detection', 'registry-v1.json');
const VERIFIED_OVERRIDES_PATH = path.join(ROOT, 'operations', 'plan-detection', 'verified-overrides-v1.json');
const PRIMARY_REVIEWED_OVERRIDES_PATH = path.join(ROOT, 'operations', 'plan-detection', 'primary-reviewed-overrides-v1.json');
const QUEUE_PATH = path.join(ROOT, 'operations', 'plan-detection', 'research-queue-v1.json');
const PUBLIC_SUMMARY_PATH = path.join(ROOT, 'site', 'data', 'plan-detection-summary-v1.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

if (!fs.existsSync(UNIVERSE_PATH)) {
  throw new Error('Company universe is missing. Run company:universe:build first.');
}

const universe = readJson(UNIVERSE_PATH);
if (universe.version !== 'company-universe-v1' || !Array.isArray(universe.companies)) {
  throw new Error('Unsupported company universe format');
}

let verifiedByCode = new Map();
if (fs.existsSync(VERIFIED_OVERRIDES_PATH)) {
  const verified = readJson(VERIFIED_OVERRIDES_PATH);
  if (
    verified.version !== 'plan-detection-verified-overrides-v1'
    || !Array.isArray(verified.overrides)
  ) {
    throw new Error('Unsupported verified plan detection override format');
  }
  verifiedByCode = new Map(
    verified.overrides.map(item => [String(item.code), item]),
  );
}

let primaryReviewedByCode = new Map();
if (fs.existsSync(PRIMARY_REVIEWED_OVERRIDES_PATH)) {
  const primaryReviewed = readJson(PRIMARY_REVIEWED_OVERRIDES_PATH);
  if (
    primaryReviewed.version !== 'plan-detection-primary-reviewed-overrides-v1'
    || !Array.isArray(primaryReviewed.overrides)
  ) {
    throw new Error('Unsupported primary-reviewed plan detection override format');
  }
  primaryReviewedByCode = new Map(
    primaryReviewed.overrides.map(item => [String(item.code), item]),
  );
}

let previousByCode = new Map();
if (fs.existsSync(REGISTRY_PATH)) {
  const previous = readJson(REGISTRY_PATH);
  if (previous.version !== 'plan-detection-registry-v1' || !Array.isArray(previous.companies)) {
    throw new Error('Unsupported plan detection registry format');
  }
  previousByCode = new Map(previous.companies.map(company => [String(company.code), company]));
}

const companies = universe.companies.map(listing => {
  const code = String(listing.code);
  const previous = previousByCode.get(code);
  const primaryReviewed = primaryReviewedByCode.get(code);
  const verified = verifiedByCode.get(code);

  return resolveCompanyStatus(listing, previous, primaryReviewed, verified);
}).sort((a, b) => a.code.localeCompare(b.code, 'ja'));

// Regression assertions to enforce L1 review gate and endpoint parsing rules
const companyMap = new Map(companies.map(c => [c.code, c]));

// 1. L1 Review Gate: 3173 has no primary review complete or verified override -> must remain not_checked
const c3173 = companyMap.get('3173');
if (c3173 && c3173.status !== 'not_checked') {
  throw new Error(`Regression test failed: 3173 must remain not_checked but got ${c3173.status}`);
}

// 2. Ordinary earnings disclosures without formal plan evidence -> 1381, 1418 must remain not_checked
const c1381 = companyMap.get('1381');
if (c1381 && c1381.status !== 'not_checked') {
  throw new Error(`Regression test failed: 1381 must remain not_checked but got ${c1381.status}`);
}
const c1418 = companyMap.get('1418');
if (c1418 && c1418.status !== 'not_checked') {
  throw new Error(`Regression test failed: 1418 must remain not_checked but got ${c1418.status}`);
}

// 3. Test 1332 plan endpoint extraction: 2025-2027 plan endpoint 2028-03-31 wins over 2030 vision target
const dates1332 = extractEndDates('中期経営計画 GOOD FOODS Recipe2 (2025年度～2027年度) （長期ビジョン2030）');
dates1332.sort((a, b) => a.date.localeCompare(b.date));
const planEnd1332 = dates1332.at(-1);
if (!planEnd1332 || planEnd1332.date !== '2028-03-31') {
  throw new Error(`Regression test failed: 1332 planEndDate should be 2028-03-31 but got ${planEnd1332?.date}`);
}

// 4. Test slash-form fiscal period parsing
const testSlashForm1 = extractEndDates('FY2025/3-FY2027/3');
if (!testSlashForm1.some(d => d.date === '2027-03-31')) {
  throw new Error(`Slash-form fiscal period parsing failed for FY2025/3-FY2027/3`);
}
const testSlashForm2 = extractEndDates('2026年4月期-2027年4月期');
if (!testSlashForm2.some(d => d.date === '2027-04-30')) {
  throw new Error(`Slash-form fiscal period parsing failed for 2026年4月期-2027年4月期`);
}

// 5. Ambiguous two-digit FY labels (FY76-FY80) must be rejected
const testAmbiguousFY = extractEndDates('新中長期経営計画ローリングプラン(FY76-FY80)');
if (testAmbiguousFY.length > 0) {
  throw new Error(`Ambiguous 2-digit FY labels FY76-FY80 must be rejected but extracted: ${JSON.stringify(testAmbiguousFY)}`);
}

const activeCodes = new Set(companies.map(company => company.code));
const archived = [...previousByCode.values()]
  .filter(company => !activeCodes.has(String(company.code)))
  .map(company => ({
    ...company,
    listingStatus: 'inactive_or_out_of_scope',
  }))
  .sort((a, b) => String(a.code).localeCompare(String(b.code), 'ja'));

const counts = Object.fromEntries(
  [...ALLOWED_STATUSES].map(status => [status, companies.filter(company => company.status === status).length]),
);
const resolvedCount = companies.filter(company => RESOLVED_STATUSES.has(company.status)).length;
const detectionCoverage = companies.length ? resolvedCount / companies.length : 0;

const registry = {
  version: 'plan-detection-registry-v1',
  universeGeneratedAt: universe.generatedAt || null,
  sourceFetchedAt: universe.sourceFetchedAt || null,
  companyCount: companies.length,
  resolvedCount,
  detectionCoverage: Number(detectionCoverage.toFixed(6)),
  verifiedOverrideCount: verifiedByCode.size,
  primaryReviewedOverrideCount: primaryReviewedByCode.size,
  counts,
  companies,
  archived,
};

const queue = {
  version: 'plan-detection-research-queue-v1',
  universeGeneratedAt: universe.generatedAt || null,
  companyCount: companies.length,
  pendingCount: counts.not_checked,
  policy: {
    goal: 'Reach 100% Plan Detection Coverage without inferring plan existence.',
    completionRequires: ['official_or_first_party_source', 'checkedAt', 'explicit_status'],
    statuses: [...ALLOWED_STATUSES],
  },
  companies: companies
    .filter(company => company.status === 'not_checked')
    .map(company => ({
      code: company.code,
      name: company.name,
      market: company.market,
      industry: company.industry,
      status: company.status,
      researchTask: 'Confirm whether a formal/current mid-term management plan exists using first-party IR evidence.',
    })),
};

const publicSummary = {
  version: 'plan-detection-summary-v1',
  universeGeneratedAt: universe.generatedAt || null,
  sourceFetchedAt: universe.sourceFetchedAt || null,
  companyCount: companies.length,
  resolvedCount,
  pendingCount: counts.not_checked,
  detectionCoverage: registry.detectionCoverage,
  verifiedOverrideCount: verifiedByCode.size,
  primaryReviewedOverrideCount: primaryReviewedByCode.size,
  counts,
};

writeJson(REGISTRY_PATH, registry);
writeJson(QUEUE_PATH, queue);
writeJson(PUBLIC_SUMMARY_PATH, publicSummary);

console.log(JSON.stringify(publicSummary, null, 2));
