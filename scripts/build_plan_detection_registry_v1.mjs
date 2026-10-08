import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const UNIVERSE_PATH = path.join(ROOT, 'operations', 'universe', 'current-universe-v1.json');
const REGISTRY_PATH = path.join(ROOT, 'operations', 'plan-detection', 'registry-v1.json');
const VERIFIED_OVERRIDES_PATH = path.join(ROOT, 'operations', 'plan-detection', 'verified-overrides-v1.json');
const PRIMARY_REVIEWED_OVERRIDES_PATH = path.join(ROOT, 'operations', 'plan-detection', 'primary-reviewed-overrides-v1.json');
const QUEUE_PATH = path.join(ROOT, 'operations', 'plan-detection', 'research-queue-v1.json');
const PUBLIC_SUMMARY_PATH = path.join(ROOT, 'site', 'data', 'plan-detection-summary-v1.json');
const MANIFEST_PATH = path.join(ROOT, 'site', 'data', 'bundle.manifest.json');
const PATCH_DIR = path.join(ROOT, 'operations', 'patches');

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

function tokyoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const REFERENCE_DATE = process.env.PLAN_DETECTION_REFERENCE_DATE || tokyoToday();

function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y
    || date.getUTCMonth() !== m - 1
    || date.getUTCDate() !== d
  ) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function monthEnd(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toIsoDate(y, m, day);
}

function flattenStrings(value, out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/baseline|previous|actual|start/i.test(key)) continue;
      flattenStrings(item, out);
    }
  }
  return out;
}

function focusPeriodText(value) {
  if (typeof value !== 'string') return value;
  const segments = value
    .split(/[／/]|、(?=\s*(?:中期|長期|現行|Vision|ビジョン))/i)
    .map(text => text.trim())
    .filter(Boolean);
  const midTerm = segments.find(text =>
    /中期|mid[-\s]?term|現行(?:中計|計画)|current\s+plan/i.test(text)
    && !/長期|long[-\s]?term/i.test(text)
  );
  let focused = midTerm || segments[0] || value;
  focused = focused.replace(
    /[（(][^）)]*(?:長期|long[-\s]?term|vision|ビジョン|目指す姿|上位方針)[^）)]*[）)]/gi,
    '',
  );
  return focused.trim();
}

function extractEndDates(value) {
  const dates = [];
  for (const rawText of flattenStrings(value)) {
    const text = String(focusPeriodText(rawText) || rawText);
    for (const match of text.matchAll(/\bFY\s*(20\d{2}|[2-9]\d)[./-](1[0-2]|0?[1-9])\b/gi)) {
      const raw = Number(match[1]);
      const year = raw < 100 ? 2000 + raw : raw;
      const date = monthEnd(year, match[2]);
      if (date) dates.push({ date, basis: match[0], precision: 'fy_month_end' });
    }
    for (const match of text.matchAll(/(20\d{2})年\s*(1[0-2]|0?[1-9])月期/g)) {
      const date = monthEnd(match[1], match[2]);
      if (date) dates.push({ date, basis: match[0], precision: 'month_end' });
    }
    for (const match of text.matchAll(/(20\d{2})年度/g)) {
      const date = toIsoDate(Number(match[1]) + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'fiscal_year' });
    }
    for (const match of text.matchAll(/\bFY\s*([2-9]\d|20\d{2})(?![./-]\d)\b/gi)) {
      const raw = Number(match[1]);
      const year = raw < 100 ? 2000 + raw : raw;
      const date = toIsoDate(year + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'fy_label' });
    }
    for (const match of text.matchAll(/(20\d{2})年(?!\s*(?:1[0-2]|0?[1-9])月)/g)) {
      const date = toIsoDate(match[1], 12, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'calendar_year' });
    }
    for (const match of text.matchAll(/(?:20\d{2})[-~～─](20\d{2})/g)) {
      const date = toIsoDate(Number(match[1]) + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'range_end_year' });
    }
  }
  return dates;
}

if (!fs.existsSync(UNIVERSE_PATH)) {
  throw new Error('Company universe is missing. Run company:universe:build first.');
}

const universe = readJson(UNIVERSE_PATH);
if (universe.version !== 'company-universe-v1' || !Array.isArray(universe.companies)) {
  throw new Error('Unsupported company universe format');
}

const officialByCode = new Map();
if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = readJson(MANIFEST_PATH);
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(ROOT, 'site', 'data', part.file))),
  );
  const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  for (const company of bundle.companies || []) {
    if (company.code) officialByCode.set(String(company.code).toUpperCase(), company);
  }
}

if (fs.existsSync(PATCH_DIR)) {
  const patchFiles = fs.readdirSync(PATCH_DIR).filter(f => f.endsWith('.json'));
  for (const file of patchFiles) {
    const patch = readJson(path.join(PATCH_DIR, file));
    if (patch.companyCode) {
      const code = String(patch.companyCode).toUpperCase();
      const existing = officialByCode.get(code) || {};
      const updates = patch.updates || {};
      officialByCode.set(code, {
        ...existing,
        ...patch,
        ...updates,
        sourceUrl: updates.sourceUrl || patch.sourceUrl || existing.sourceUrl,
        document: updates.document || patch.document || existing.document,
        period: updates.period || patch.period || existing.period,
        planPublishedDate: updates.planPublishedDate || patch.planPublishedDate || existing.planPublishedDate,
        lastVerifiedDate: updates.lastVerifiedDate || patch.lastVerifiedDate || existing.lastVerifiedDate,
      });
    }
  }
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

const autoDerivedMethods = new Set([
  'quality_rebase_phase2_independent_completion_v1',
  'quality_rebase_primary_review_l1_seed_v1',
  'quality_rebase_official_source_evidence_v1',
]);

const companies = universe.companies.map(listing => {
  const code = String(listing.code);
  const previous = previousByCode.get(code);
  const primaryReviewed = primaryReviewedByCode.get(code);
  const verified = verifiedByCode.get(code);
  const official = officialByCode.get(code.toUpperCase());

  const previousIsAutoDerived = autoDerivedMethods.has(previous?.review?.method);

  let selected = previousIsAutoDerived ? null : previous;
  let selectedDerivation = previousIsAutoDerived ? null : (previous?.derivation || null);

  const manualPreviousIsNewerThan = seed => {
    const previousCheckedAt = String(previous?.review?.checkedAt || '');
    const seedCheckedAt = String(seed?.review?.checkedAt || '');
    return (
      previous
      && !previousIsAutoDerived
      && RESOLVED.has(previous.status)
      && validDate(previousCheckedAt)
      && validDate(seedCheckedAt)
      && previousCheckedAt > seedCheckedAt
    );
  };

  if (primaryReviewed && !manualPreviousIsNewerThan(primaryReviewed)) {
    selected = primaryReviewed;
    selectedDerivation = primaryReviewed.derivation || null;
  }

  // Independently reviewed evidence always outranks a primary-review seed,
  // unless a newer explicit manual L1 decision exists.
  if (verified && !manualPreviousIsNewerThan(verified)) {
    selected = verified;
    selectedDerivation = verified.derivation || null;
  }

  if ((!selected || selected.status === 'not_checked') && official) {
    const sourceUrl = official.sourceUrl;
    if (validUrl(sourceUrl)) {
      const doc = String(official.document || '');
      const cat = String(official.category || '');
      const period = String(official.period || '');
      const pubDate = String(official.planPublishedDate || official.lastVerifiedDate || '').slice(0, 10);
      const checkedAt = validDate(pubDate)
        ? pubDate
        : (validDate(official.lastVerifiedDate)
            ? String(official.lastVerifiedDate).slice(0, 10)
            : REFERENCE_DATE);

      const hasFormalPlanSignal =
        /中期経営計画|中長期経営計画|中期経営戦略|中期方針|中期事業計画|中期目標|中期課題|ビジョン.*中期|ロードマップ/i.test(doc)
        || /中期経営計画/i.test(cat);

      const hasUnstructuredPlanSignal =
        /事業計画及び成長可能性|成長可能性に関する説明資料|事業計画書/i.test(doc)
        || /事業計画及び成長可能性/i.test(cat);

      let derivedStatus = null;
      let planEnd = null;
      let note = null;

      if (hasFormalPlanSignal) {
        const textsToSearch = [];
        if (period && period !== '当該公式開示資料の対象期間') {
          textsToSearch.push(period);
        }
        textsToSearch.push(doc);

        const dates = extractEndDates(textsToSearch);
        if (dates.length > 0) {
          dates.sort((a, b) => a.date.localeCompare(b.date));
          planEnd = dates.at(-1);
          derivedStatus = planEnd.date >= REFERENCE_DATE ? 'current' : 'expired';
          note = `official source evidence confirmed formal plan; plan end ${planEnd.date} derived from ${planEnd.basis}`;
        }
      } else if (hasUnstructuredPlanSignal) {
        derivedStatus = 'found_unstructured';
        note = `official JPX disclosure confirmed unstructured business/growth plan: ${doc}`;
      }

      if (derivedStatus) {
        selected = {
          code,
          name: listing.name,
          market: listing.market,
          industry: listing.industry,
          status: derivedStatus,
          review: {
            checkedAt,
            sourceUrl,
            sourceTitle: doc || listing.name,
            sourceType: 'official_first_party_indexed',
            method: 'quality_rebase_official_source_evidence_v1',
            note,
          },
        };
        selectedDerivation = {
          referenceDate: REFERENCE_DATE,
          sourceType: 'official_first_party_indexed',
          document: doc || null,
          period: official.period || null,
          publishedDate: validDate(pubDate) ? pubDate : null,
          planEndDate: planEnd?.date || null,
          planEndBasis: planEnd?.basis || null,
        };
      }
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

// Regression assertions to guarantee false positives are prevented and plan ends are accurately derived
const companyMap = new Map(companies.map(c => [c.code, c]));
const c1381 = companyMap.get('1381');
if (c1381 && c1381.status !== 'not_checked') {
  throw new Error(`Regression test failed: 1381 should remain not_checked but got ${c1381.status}`);
}
const c1418 = companyMap.get('1418');
if (c1418 && c1418.status !== 'not_checked') {
  throw new Error(`Regression test failed: 1418 should remain not_checked but got ${c1418.status}`);
}
const c1332 = companyMap.get('1332');
if (c1332) {
  if (c1332.status !== 'current') {
    throw new Error(`Regression test failed: 1332 should be current but got ${c1332.status}`);
  }
  if (c1332.derivation?.planEndDate !== '2028-03-31') {
    throw new Error(`Regression test failed: 1332 planEndDate should be 2028-03-31 but got ${c1332.derivation?.planEndDate}`);
  }
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
  primaryReviewedOverrideCount: primaryReviewedByCode.size,
  counts,
};

writeJson(REGISTRY_PATH, registry);
writeJson(QUEUE_PATH, queue);
writeJson(PUBLIC_SUMMARY_PATH, publicSummary);

console.log(JSON.stringify(publicSummary, null, 2));
