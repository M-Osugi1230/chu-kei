import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const UNIVERSE_PATH = path.join(ROOT, 'operations', 'universe', 'current-universe-v1.json');
const REGISTRY_PATH = path.join(ROOT, 'operations', 'plan-detection', 'registry-v1.json');
const QUEUE_PATH = path.join(ROOT, 'operations', 'plan-detection', 'research-queue-v1.json');
const PUBLIC_SUMMARY_PATH = path.join(ROOT, 'site', 'data', 'plan-detection-summary-v1.json');

const STATUSES = new Set([
  'current',
  'expired',
  'no_formal_plan',
  'found_unstructured',
  'not_checked',
]);
const RESOLVED = new Set(['current', 'expired', 'no_formal_plan', 'found_unstructured']);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const validUrl = value => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

if (!fs.existsSync(UNIVERSE_PATH)) {
  throw new Error('Company universe is missing. Run company:universe:build first.');
}

const universe = readJson(UNIVERSE_PATH);
if (universe.version !== 'company-universe-v1' || !Array.isArray(universe.companies)) {
  throw new Error('Unsupported company universe format');
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
  const status = previous?.status || 'not_checked';

  if (!STATUSES.has(status)) throw new Error(`Invalid plan detection status for ${code}: ${status}`);

  const review = previous?.review && typeof previous.review === 'object'
    ? {
        checkedAt: previous.review.checkedAt || null,
        sourceUrl: previous.review.sourceUrl || null,
        sourceTitle: previous.review.sourceTitle || null,
        sourceType: previous.review.sourceType || null,
        method: previous.review.method || null,
        note: previous.review.note || null,
      }
    : {
        checkedAt: null,
        sourceUrl: null,
        sourceTitle: null,
        sourceType: null,
        method: null,
        note: null,
      };

  if (RESOLVED.has(status)) {
    if (!validDate(review.checkedAt)) {
      throw new Error(`Resolved status requires checkedAt for ${code}`);
    }
    if (!validUrl(review.sourceUrl)) {
      throw new Error(`Resolved status requires sourceUrl for ${code}`);
    }
  }

  return {
    code,
    name: listing.name,
    market: listing.market,
    industry: listing.industry,
    status,
    review,
  };
}).sort((a, b) => a.code.localeCompare(b.code, 'ja'));

const activeCodes = new Set(companies.map(company => company.code));
const archived = [...previousByCode.values()]
  .filter(company => !activeCodes.has(String(company.code)))
  .map(company => ({
    ...company,
    listingStatus: 'inactive_or_out_of_scope',
  }))
  .sort((a, b) => String(a.code).localeCompare(String(b.code), 'ja'));

const counts = Object.fromEntries(
  [...STATUSES].map(status => [status, companies.filter(company => company.status === status).length]),
);
const resolvedCount = companies.filter(company => RESOLVED.has(company.status)).length;
const detectionCoverage = companies.length ? resolvedCount / companies.length : 0;

const registry = {
  version: 'plan-detection-registry-v1',
  universeGeneratedAt: universe.generatedAt || null,
  sourceFetchedAt: universe.sourceFetchedAt || null,
  companyCount: companies.length,
  resolvedCount,
  detectionCoverage: Number(detectionCoverage.toFixed(6)),
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
    statuses: [...STATUSES],
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
  counts,
};

writeJson(REGISTRY_PATH, registry);
writeJson(QUEUE_PATH, queue);
writeJson(PUBLIC_SUMMARY_PATH, publicSummary);

console.log(JSON.stringify(publicSummary, null, 2));
