import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const UNIVERSE_PATH = path.join(ROOT, 'operations', 'universe', 'current-universe-v1.json');
const REGISTRY_PATH = path.join(ROOT, 'operations', 'plan-detection', 'registry-v1.json');
const VERIFIED_OVERRIDES_PATH = path.join(ROOT, 'operations', 'plan-detection', 'verified-overrides-v1.json');
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
  const verified = verifiedByCode.get(code);
  const previousIsAutoDerived =
    previous?.review?.method === 'quality_rebase_phase2_independent_completion_v1';

  let selected = previousIsAutoDerived ? null : previous;
  let selectedDerivation = previousIsAutoDerived ? null : (previous?.derivation || null);

  if (verified) {
    const previousCheckedAt = String(previous?.review?.checkedAt || '');
    const verifiedCheckedAt = String(verified?.review?.checkedAt || '');
    const manualPreviousIsNewer =
      previous
      && !previousIsAutoDerived
      && RESOLVED.has(previous.status)
      && validDate(previousCheckedAt)
      && validDate(verifiedCheckedAt)
      && previousCheckedAt > verifiedCheckedAt;

    if (!manualPreviousIsNewer) {
      selected = verified;
      selectedDerivation = verified.derivation || null;
    }
  }

  const status = selected?.status || 'not_checked';

  if (!STATUSES.has(status)) throw new Error(`Invalid plan detection status for ${code}: ${status}`);

  const review = selected?.review && typeof selected.review === 'object'
    ? {
        checkedAt: selected.review.checkedAt || null,
        sourceUrl: selected.review.sourceUrl || null,
        sourceTitle: selected.review.sourceTitle || null,
        sourceType: selected.review.sourceType || null,
        method: selected.review.method || null,
        note: selected.review.note || null,
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
    derivation: selectedDerivation,
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
  verifiedOverrideCount: verifiedByCode.size,
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
  verifiedOverrideCount: verifiedByCode.size,
  counts,
};

writeJson(REGISTRY_PATH, registry);
writeJson(QUEUE_PATH, queue);
writeJson(PUBLIC_SUMMARY_PATH, publicSummary);

console.log(JSON.stringify(publicSummary, null, 2));
