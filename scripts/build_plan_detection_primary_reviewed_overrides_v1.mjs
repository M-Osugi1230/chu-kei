import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'plan-detection', 'primary-reviewed-overrides-v1.json');
const REVIEW_DIRS = [
  path.join(ROOT, 'operations', 'quality-rebase', 'phase1', 'reviews'),
  path.join(ROOT, 'operations', 'quality-rebase', 'phase2', 'reviews'),
  path.join(ROOT, 'operations', 'quality-rebase', 'phase2', 'primary-reviews'),
];

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
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

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function validUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

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

function extractEndDates(value) {
  const dates = [];
  for (const text of flattenStrings(value)) {
    for (const match of text.matchAll(/(20\d{2})年\s*(1[0-2]|0?[1-9])月期/g)) {
      const date = monthEnd(match[1], match[2]);
      if (date) dates.push({ date, basis: match[0], precision: 'month_end' });
    }
    for (const match of text.matchAll(/(20\d{2})年度/g)) {
      const date = toIsoDate(Number(match[1]) + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'fiscal_year' });
    }
    for (const match of text.matchAll(/\bFY\s*([2-9]\d|20\d{2})\b/gi)) {
      const raw = Number(match[1]);
      const year = raw < 100 ? 2000 + raw : raw;
      const date = toIsoDate(year + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'fy_label' });
    }
    for (const match of text.matchAll(/(20\d{2})年(?!\s*(?:1[0-2]|0?[1-9])月)/g)) {
      const date = toIsoDate(match[1], 12, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'calendar_year' });
    }
  }
  return dates;
}

function derivePlanEnd(primary) {
  const source = primary.source || primary.document || {};
  const structured = primary.structuredAnalysis || {};
  const period = source.period ?? primary.period ?? structured.period ?? null;
  let candidates = [];

  if (period && typeof period === 'object' && !Array.isArray(period)) {
    const explicitEndEntries = Object.entries(period)
      .filter(([key]) => /(?:end|terminal|targetClosing|currentPlanTerminal)/i.test(key))
      .map(([, value]) => value);
    for (const value of explicitEndEntries) candidates.push(...extractEndDates(value));
  } else {
    candidates.push(...extractEndDates(period));
  }

  const boundary =
    source.formalPlanBoundary
    || primary.formalPlanBoundary
    || primary.document?.formalPlanBoundary
    || null;
  if (!candidates.length && boundary && typeof boundary === 'object') {
    const boundaryEntries = Object.entries(boundary)
      .filter(([key]) => /(?:currentPlanTerminal|currentPlan$|currentPlanPeriod|planPeriod)/i.test(key))
      .map(([, value]) => value);
    for (const value of boundaryEntries) candidates.push(...extractEndDates(value));
  }

  const classification = String(
    source.documentClassification
    || source.sourceClassification
    || primary.document?.documentClassification
    || primary.document?.sourceClassification
    || '',
  );
  if (!candidates.length) {
    for (const match of classification.matchAll(/(?:to|through|until)_?(20\d{2})/gi)) {
      const date = toIsoDate(Number(match[1]) + 1, 3, 31);
      if (date) candidates.push({
        date,
        basis: match[0],
        precision: 'classification_year_fallback',
      });
    }
  }

  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return {
    period: period || boundary || null,
    planEnd: candidates.length ? candidates.at(-1) : null,
    allCandidates: candidates,
  };
}

function getBoolean(record, paths) {
  for (const keys of paths) {
    let value = record;
    for (const key of keys) {
      if (!value || typeof value !== 'object' || !(key in value)) {
        value = undefined;
        break;
      }
      value = value[key];
    }
    if (value === true) return true;
  }
  return false;
}

function formalPlanConfirmed(primary) {
  const validation = primary.validation || {};
  const source = primary.source || {};
  const document = primary.document || {};
  if (validation.formalPlanConfirmed === true) return true;
  if (source.formalPlanConfirmed === true) return true;
  if (document.formalPlanConfirmed === true) return true;
  return false;
}

function officialSource(primary) {
  const source = primary.source || primary.document || {};
  return {
    title:
      source.title
      || source.candidateTitle
      || primary.document?.title
      || primary.document?.candidateTitle
      || null,
    url:
      source.officialUrl
      || source.correctedOfficialUrl
      || source.correctedOfficialListingUrl
      || source.officialLandingPage
      || primary.document?.officialUrl
      || primary.document?.sourceUrl
      || null,
    publishedDate:
      source.publishedDate
      || primary.document?.publishedDate
      || primary.document?.candidatePublishedDate
      || null,
    classification:
      source.documentClassification
      || source.sourceClassification
      || primary.document?.documentClassification
      || primary.document?.sourceClassification
      || null,
  };
}

function reviewDate(primary) {
  const review = primary.review || {};
  for (const value of [
    review.reviewedAt,
    review.primaryReviewCompletedAt,
    review.completedAt,
    review.updatedAt,
  ]) {
    const date = String(value || '').slice(0, 10);
    if (validDate(date)) return date;
  }
  return null;
}

function passesPrimaryL1Gate(primary) {
  const review = primary.review || {};
  const status = String(review.status || '');
  const source = officialSource(primary);
  const company = primary.company || {};

  const companyIdentityConfirmed = getBoolean(primary, [
    ['validation', 'companyIdentityConfirmed'],
    ['validation', 'sourceIdentityConfirmed'],
    ['document', 'companyIdentityConfirmed'],
    ['source', 'companyIdentityConfirmed'],
  ]);
  const fullTextHumanReviewComplete = getBoolean(primary, [
    ['validation', 'fullTextHumanReviewComplete'],
    ['document', 'fullTextHumanReviewComplete'],
    ['source', 'fullTextHumanReviewComplete'],
  ]);
  const metricsValidated = getBoolean(primary, [
    ['validation', 'metricsValidated'],
    ['validation', 'metricsValidatedPrimaryPass'],
  ]);
  const evidenceLinked = getBoolean(primary, [
    ['validation', 'fieldLevelEvidenceLinked'],
    ['validation', 'evidenceLinked'],
  ]);

  const checks = {
    primaryReviewComplete: status.startsWith('primary_review_complete'),
    companyCodePresent: Boolean(String(company.code || '').trim()),
    companyIdentityConfirmed,
    formalPlanConfirmed: formalPlanConfirmed(primary),
    fullTextHumanReviewComplete,
    metricsValidated,
    evidenceLinked,
    officialSourceUrlPresent: validUrl(source.url),
    reviewDatePresent: Boolean(reviewDate(primary)),
    automaticApprovalDisabled: review.automaticApprovalAllowed !== true,
    deepVerificationNotAutoApproved: review.deepVerificationApproved !== true,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    source,
  };
}

function discoverReviewFiles() {
  const files = [];
  for (const dir of REVIEW_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || !name.includes('primary-review')) continue;
      files.push(path.join(dir, name));
    }
  }
  return files.sort();
}

const independentPath = path.join(
  ROOT,
  'operations',
  'plan-detection',
  'verified-overrides-v1.json',
);
const independentCodes = new Set();
if (fs.existsSync(independentPath)) {
  const independent = readJson(independentPath);
  for (const row of independent.overrides || []) independentCodes.add(String(row.code));
}

const candidateByCode = new Map();
const rejected = [];

for (const file of discoverReviewFiles()) {
  let primary;
  try {
    primary = readJson(file);
  } catch (error) {
    rejected.push({
      file: path.relative(ROOT, file),
      reason: 'invalid_json',
      error: String(error),
    });
    continue;
  }

  const code = String(primary.company?.code || '').trim().toUpperCase();
  if (!code) {
    rejected.push({ file: path.relative(ROOT, file), reason: 'company_code_missing' });
    continue;
  }

  const gate = passesPrimaryL1Gate(primary);
  if (!gate.passed) {
    rejected.push({
      code,
      name: primary.company?.name || null,
      file: path.relative(ROOT, file),
      reason: 'primary_l1_gate_not_satisfied',
      failedChecks: Object.entries(gate.checks)
        .filter(([, passed]) => !passed)
        .map(([key]) => key),
    });
    continue;
  }

  const derived = derivePlanEnd(primary);
  if (!derived.planEnd) {
    rejected.push({
      code,
      name: primary.company?.name || null,
      file: path.relative(ROOT, file),
      reason: 'formal_plan_confirmed_but_end_date_unresolved',
      classification: gate.source.classification,
      period: derived.period,
    });
    continue;
  }

  const checkedAt = reviewDate(primary);
  const item = {
    code,
    name: primary.company?.name || null,
    status: derived.planEnd.date >= REFERENCE_DATE ? 'current' : 'expired',
    review: {
      checkedAt,
      sourceUrl: gate.source.url,
      sourceTitle: gate.source.title,
      sourceType: 'first_party_primary_reviewed',
      method: 'quality_rebase_primary_review_l1_seed_v1',
      note:
        `primary human review confirmed formal plan; plan end ${derived.planEnd.date} derived from ${derived.planEnd.basis}`,
    },
    derivation: {
      referenceDate: REFERENCE_DATE,
      assuranceTier: 'primary_human_review',
      formalPlanConfirmed: true,
      classification: gate.source.classification,
      period: derived.period,
      planEndDate: derived.planEnd.date,
      planEndBasis: derived.planEnd.basis,
      planEndPrecision: derived.planEnd.precision,
      primaryReviewFile: path.relative(ROOT, file),
      publishedDate: gate.source.publishedDate,
      supersededByIndependentSeed: independentCodes.has(code),
    },
  };

  const previous = candidateByCode.get(code);
  const previousCheckedAt = String(previous?.review?.checkedAt || '');
  const thisCheckedAt = String(item.review.checkedAt || '');
  const previousFile = String(previous?.derivation?.primaryReviewFile || '');
  const thisFile = String(item.derivation.primaryReviewFile || '');
  if (
    !previous
    || thisCheckedAt > previousCheckedAt
    || (thisCheckedAt === previousCheckedAt && thisFile > previousFile)
  ) {
    candidateByCode.set(code, item);
  }
}

const overrides = [...candidateByCode.values()]
  .filter(item => !independentCodes.has(item.code))
  .sort((a, b) => a.code.localeCompare(b.code, 'ja'));
const allEligible = [...candidateByCode.values()]
  .sort((a, b) => a.code.localeCompare(b.code, 'ja'));

const counts = {
  reviewFilesScanned: discoverReviewFiles().length,
  uniqueEligiblePrimaryReviewedCompanies: allEligible.length,
  supersededByIndependentSeed: allEligible.filter(item => independentCodes.has(item.code)).length,
  primaryOverrides: overrides.length,
  current: overrides.filter(item => item.status === 'current').length,
  expired: overrides.filter(item => item.status === 'expired').length,
  rejectedReviewFiles: rejected.length,
};

const output = {
  version: 'plan-detection-primary-reviewed-overrides-v1',
  generatedAt: new Date().toISOString(),
  referenceDate: REFERENCE_DATE,
  sourceReviewDirectories: REVIEW_DIRS
    .filter(fs.existsSync)
    .map(dir => path.relative(ROOT, dir)),
  policy: {
    requirePrimaryReviewComplete: true,
    requireCompanyIdentityConfirmed: true,
    requireFormalPlanConfirmed: true,
    requireFullTextHumanReviewComplete: true,
    requireMetricsValidated: true,
    requireFieldLevelEvidence: true,
    requireOfficialSourceUrl: true,
    requireReviewDate: true,
    requirePlanEndForCurrentness: true,
    independentReviewedSeedHasPrecedence: true,
    formalPlanFalseDoesNotImplyNoFormalPlan: true,
    unresolvedEvidenceRemainsNotChecked: true,
  },
  counts,
  overrides,
  rejected,
};

writeJson(OUTPUT_PATH, output);
console.log(JSON.stringify({ version: output.version, referenceDate: REFERENCE_DATE, counts }, null, 2));
