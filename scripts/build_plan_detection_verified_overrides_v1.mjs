import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const STATUS_PATH = path.join(ROOT, 'operations', 'quality-rebase', 'phase2', 'independent-review-status-v1.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'plan-detection', 'verified-overrides-v1.json');

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
  const period = source.period ?? primary.period ?? null;
  const candidates = extractEndDates(period);

  const classification = String(source.documentClassification || '');
  for (const match of classification.matchAll(/(?:to|through|until)_?(20\d{2})/gi)) {
    const date = toIsoDate(Number(match[1]) + 1, 3, 31);
    if (date) candidates.push({ date, basis: match[0], precision: 'classification_year' });
  }

  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return {
    period,
    planEnd: candidates.length ? candidates.at(-1) : null,
    allCandidates: candidates,
  };
}

function officialSource(primary, completion) {
  const source = primary.source || primary.document || {};
  return {
    title: source.title || completion.source?.title || null,
    url:
      source.officialUrl
      || source.correctedOfficialUrl
      || source.correctedOfficialListingUrl
      || source.officialLandingPage
      || completion.source?.officialUrl
      || null,
    publishedDate: source.publishedDate || primary.document?.publishedDate || null,
    classification: source.documentClassification || source.classification || null,
  };
}

function explicitNoFormalPlan(primary) {
  const source = primary.source || primary.document || {};
  const validation = primary.validation || {};
  const classification = String(source.documentClassification || '').toLowerCase();
  return (
    source.previousFormalPlanAbolished === true
    || validation.previousFormalPlanAbolished === true
    || /(?:no_formal|without_formal|formal_plan_abolition|after_formal_plan_abolition|not_formal_plan)/.test(classification)
  );
}

if (!fs.existsSync(STATUS_PATH)) {
  throw new Error('Independent review status is missing');
}

const status = readJson(STATUS_PATH);
if (
  status.schemaVersion !== 'quality-rebase-phase2-independent-review-status-v1'
  || !Array.isArray(status.completionRecords)
) {
  throw new Error('Unsupported independent review status format');
}

const overrides = [];
const unresolved = [];

for (const record of status.completionRecords) {
  if (record.status !== 'independent_review_complete') continue;

  const completionPath = path.join(ROOT, record.file);
  if (!fs.existsSync(completionPath)) {
    unresolved.push({
      code: String(record.code),
      name: record.name,
      reason: 'independent_completion_file_missing',
      file: record.file,
    });
    continue;
  }

  const completion = readJson(completionPath);
  const primaryReviewPath = completion.primaryReviewFile
    ? path.join(ROOT, completion.primaryReviewFile)
    : null;
  if (!primaryReviewPath || !fs.existsSync(primaryReviewPath)) {
    unresolved.push({
      code: String(record.code),
      name: record.name,
      reason: 'primary_review_file_missing',
      file: completion.primaryReviewFile || null,
    });
    continue;
  }

  const primary = readJson(primaryReviewPath);
  const source = officialSource(primary, completion);
  const validation = primary.validation || {};
  const formalPlanConfirmed =
    validation.formalPlanConfirmed
    ?? primary.source?.formalPlanConfirmed
    ?? primary.document?.formalPlanConfirmed
    ?? null;

  const sourceIdentityConfirmed =
    (completion.checks || []).some(check =>
      check.id === 'source_identity' && check.status === 'confirmed'
    );
  const independentConfirmed =
    completion.review?.reviewRole === 'independent_reviewer'
    && completion.status === 'independent_review_complete'
    && String(completion.review?.result || '').startsWith('confirmed');

  if (!sourceIdentityConfirmed || !independentConfirmed || !source.url) {
    unresolved.push({
      code: String(record.code),
      name: record.name,
      reason: 'independent_evidence_gate_not_satisfied',
      sourceIdentityConfirmed,
      independentConfirmed,
      sourceUrlPresent: Boolean(source.url),
    });
    continue;
  }

  let derivedStatus = null;
  let planEnd = null;
  let period = null;
  let derivationNote = null;

  if (formalPlanConfirmed === true) {
    const derived = derivePlanEnd(primary);
    planEnd = derived.planEnd;
    period = derived.period;

    if (!planEnd) {
      unresolved.push({
        code: String(record.code),
        name: record.name,
        reason: 'formal_plan_confirmed_but_end_date_unresolved',
        classification: source.classification,
        period,
        primaryReviewFile: completion.primaryReviewFile,
      });
      continue;
    }

    derivedStatus = planEnd.date >= REFERENCE_DATE ? 'current' : 'expired';
    derivationNote = `independent review confirmed formal plan; plan end ${planEnd.date} derived from ${planEnd.basis}`;
  } else if (formalPlanConfirmed === false && explicitNoFormalPlan(primary)) {
    derivedStatus = 'no_formal_plan';
    period = primary.source?.period ?? primary.document?.period ?? null;
    derivationNote = 'independent review explicitly classified current source as no formal plan / formal plan abolished';
  } else {
    unresolved.push({
      code: String(record.code),
      name: record.name,
      reason: 'formal_plan_state_not_explicit_enough',
      formalPlanConfirmed,
      classification: source.classification,
      primaryReviewFile: completion.primaryReviewFile,
    });
    continue;
  }

  const checkedAt = String(completion.review?.completedAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) {
    unresolved.push({
      code: String(record.code),
      name: record.name,
      reason: 'independent_review_date_missing',
      completedAt: completion.review?.completedAt || null,
    });
    continue;
  }

  overrides.push({
    code: String(record.code),
    name: record.name,
    status: derivedStatus,
    review: {
      checkedAt,
      sourceUrl: source.url,
      sourceTitle: source.title,
      sourceType: 'first_party_independent_reviewed',
      method: 'quality_rebase_phase2_independent_completion_v1',
      note: derivationNote,
    },
    derivation: {
      referenceDate: REFERENCE_DATE,
      formalPlanConfirmed,
      classification: source.classification,
      period,
      planEndDate: planEnd?.date || null,
      planEndBasis: planEnd?.basis || null,
      planEndPrecision: planEnd?.precision || null,
      primaryReviewFile: completion.primaryReviewFile,
      independentCompletionFile: record.file,
      independentReviewResult: completion.review?.result || null,
    },
  });
}

overrides.sort((a, b) => a.code.localeCompare(b.code, 'ja'));
unresolved.sort((a, b) => a.code.localeCompare(b.code, 'ja'));

const counts = {
  independentReviewComplete: status.completionRecords.length,
  verifiedOverrides: overrides.length,
  current: overrides.filter(item => item.status === 'current').length,
  expired: overrides.filter(item => item.status === 'expired').length,
  noFormalPlan: overrides.filter(item => item.status === 'no_formal_plan').length,
  unresolved: unresolved.length,
};

const output = {
  version: 'plan-detection-verified-overrides-v1',
  generatedAt: new Date().toISOString(),
  referenceDate: REFERENCE_DATE,
  sourceStatusFile: path.relative(ROOT, STATUS_PATH),
  policy: {
    importOnlyIndependentReviewComplete: true,
    requireConfirmedSourceIdentity: true,
    requireIndependentReviewerResultConfirmed: true,
    requireOfficialSourceUrl: true,
    formalPlanCurrentnessDerivedFromReviewedPlanEnd: true,
    unresolvedEvidenceRemainsNotChecked: true,
    deepVerificationApprovalNotRequiredForL1PlanExistenceClassification: true,
  },
  counts,
  overrides,
  unresolved,
};

writeJson(OUTPUT_PATH, output);
console.log(JSON.stringify({ version: output.version, referenceDate: REFERENCE_DATE, counts }, null, 2));
