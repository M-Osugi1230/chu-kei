import fs from 'node:fs';
import path from 'node:path';

export const ALLOWED_STATUSES = new Set([
  'current',
  'expired',
  'no_formal_plan',
  'found_unstructured',
  'not_checked',
]);

export const ALLOWED_CANDIDATE_STATUSES = new Set([
  'current',
  'expired',
  'found_unstructured',
  'not_checked',
]);

export const RESOLVED_STATUSES = new Set([
  'current',
  'expired',
  'no_formal_plan',
  'found_unstructured',
]);

export function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

export function isDateString(val) {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

export function isHttpsUrl(val) {
  return typeof val === 'string' && val.startsWith('https://');
}

export function isPlainObject(val) {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function validateCandidateBatchPayload(file, payload, folderName, seenCodes = new Set()) {
  if (!isPlainObject(payload)) {
    throw new Error(`${file}: root payload must be an object`);
  }
  if (payload.schemaVersion !== 'plan-detection-candidate-batch-v1') {
    throw new Error(`${file}: unsupported schemaVersion`);
  }
  if (!isNonEmptyString(payload.batchId)) {
    throw new Error(`${file}: batchId is required`);
  }
  if (folderName && folderName !== payload.batchId) {
    throw new Error(`${file}: batchId '${payload.batchId}' must match directory name '${folderName}'`);
  }
  if (payload.checkedAt !== undefined && !isDateString(payload.checkedAt)) {
    throw new Error(`${file}: checkedAt must be YYYY-MM-DD`);
  }
  if (payload.nonPublic !== true) {
    throw new Error(`${file}: candidate batches must remain non-public`);
  }

  const policy = payload.policy;
  if (!isPlainObject(policy)) {
    throw new Error(`${file}: policy object is required`);
  }
  if (policy.humanReviewRequired !== true) {
    throw new Error(`${file}: human review must be required`);
  }
  if (policy.automaticPromotionAllowed !== false) {
    throw new Error(`${file}: automatic promotion must be disabled`);
  }
  if (policy.publicationAllowed !== false) {
    throw new Error(`${file}: publication must be disabled`);
  }
  if (policy.inferNoFormalPlanFromMissingEvidence !== false) {
    throw new Error(`${file}: missing evidence must never imply no formal plan`);
  }
  if (policy.finalRegistryMutationAllowed !== false) {
    throw new Error(`${file}: final registry mutation must be disabled`);
  }
  if (policy.allowedSuggestedStatuses !== undefined) {
    if (!Array.isArray(policy.allowedSuggestedStatuses)) {
      throw new Error(`${file}: policy.allowedSuggestedStatuses must be an array`);
    }
    for (const st of policy.allowedSuggestedStatuses) {
      if (!ALLOWED_CANDIDATE_STATUSES.has(st) || st === 'no_formal_plan') {
        throw new Error(`${file}: policy.allowedSuggestedStatuses contains forbidden or invalid status '${st}'`);
      }
    }
  }

  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    throw new Error(`${file}: candidates must be a non-empty array`);
  }

  for (const candidate of payload.candidates) {
    if (!isPlainObject(candidate)) {
      throw new Error(`${file}: candidate entry must be an object`);
    }
    const code = candidate.code;
    if (!isNonEmptyString(code)) {
      throw new Error(`${file}: candidate code is required`);
    }
    if (seenCodes.has(code)) {
      throw new Error(`${file}: duplicate candidate code ${code}`);
    }
    seenCodes.add(code);

    if (!isNonEmptyString(candidate.name)) {
      throw new Error(`${file}: ${code} name is required`);
    }

    const source = candidate.source;
    if (!isPlainObject(source)) {
      throw new Error(`${file}: ${code} source object is required`);
    }
    const authority = source.authority;
    if (!['official_primary', 'first_party_primary'].includes(authority)) {
      throw new Error(`${file}: ${code} source must be official/first-party primary`);
    }
    if (!isHttpsUrl(source.url)) {
      throw new Error(`${file}: ${code} source URL must be HTTPS`);
    }
    if (source.currentnessUrl !== undefined && !isHttpsUrl(source.currentnessUrl)) {
      throw new Error(`${file}: ${code} source currentnessUrl must be HTTPS`);
    }
    if (source.officialIrUrl !== undefined && !isHttpsUrl(source.officialIrUrl)) {
      throw new Error(`${file}: ${code} source officialIrUrl must be HTTPS`);
    }
    if (!isDateString(source.publishedDate)) {
      throw new Error(`${file}: ${code} publishedDate must be YYYY-MM-DD`);
    }
    if (source.currentnessCheckedAt !== undefined && !isDateString(source.currentnessCheckedAt)) {
      throw new Error(`${file}: ${code} currentnessCheckedAt must be YYYY-MM-DD`);
    }

    const observation = candidate.observation;
    if (!isPlainObject(observation)) {
      throw new Error(`${file}: ${code} observation object is required`);
    }
    const suggested = observation.suggestedStatus;
    if (!ALLOWED_CANDIDATE_STATUSES.has(suggested)) {
      throw new Error(`${file}: ${code} suggestedStatus is not allowed`);
    }
    if (suggested === 'no_formal_plan') {
      throw new Error(`${file}: ${code} no_formal_plan is forbidden at candidate stage`);
    }
    if (
      observation.exactPlanEndDate !== null
      && observation.exactPlanEndDate !== undefined
      && !isDateString(observation.exactPlanEndDate)
    ) {
      throw new Error(`${file}: ${code} exactPlanEndDate must be null or YYYY-MM-DD`);
    }

    const review = candidate.review;
    if (!isPlainObject(review)) {
      throw new Error(`${file}: ${code} review object is required`);
    }
    if (review.decision !== 'needs_review') {
      throw new Error(`${file}: ${code} decision must remain needs_review`);
    }
    if (review.status !== 'pending') {
      throw new Error(`${file}: ${code} human review must remain pending`);
    }
    if (
      !Array.isArray(review.requiredChecks)
      || review.requiredChecks.length === 0
      || review.requiredChecks.some(chk => !isNonEmptyString(chk))
    ) {
      throw new Error(`${file}: ${code} review requiredChecks must be a non-empty array of non-empty strings`);
    }

    const publication = candidate.publication;
    if (!isPlainObject(publication) || publication.eligible !== false) {
      throw new Error(`${file}: ${code} publication must remain ineligible`);
    }

    const promotion = candidate.promotion;
    if (!isPlainObject(promotion) || promotion.allowed !== false) {
      throw new Error(`${file}: ${code} promotion must remain disabled`);
    }

    const provenance = candidate.provenance;
    if (!isPlainObject(provenance)) {
      throw new Error(`${file}: ${code} provenance object is required`);
    }
    const repoPaths = provenance.repositoryPaths;
    if (!Array.isArray(repoPaths) || repoPaths.length === 0) {
      throw new Error(`${file}: ${code} repository provenance is required`);
    }
    for (const p of repoPaths) {
      if (!isNonEmptyString(p)) {
        throw new Error(`${file}: ${code} repository provenance contains an invalid path`);
      }
      if (p.startsWith('/') || p.includes('..')) {
        throw new Error(`${file}: ${code} repository provenance path '${p}' is invalid or unsafe`);
      }
    }
  }
}

export function validateCandidateFile(file, seenCodes = new Set()) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${error.message})`);
  }
  const folderName = path.basename(path.dirname(file));
  validateCandidateBatchPayload(file, payload, folderName, seenCodes);
  return payload;
}

export function toIsoDate(year, month, day) {
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

export function monthEnd(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toIsoDate(y, m, day);
}

export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function validUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function flattenStrings(value, out = []) {
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

export function focusPeriodText(value) {
  if (typeof value !== 'string') return value;
  const segments = value
    .split(/(?<!\d)\s*[／/]\s*(?!\d)|、(?=\s*(?:中期|長期|現行|Vision|ビジョン))/i)
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

export function extractEndDates(value) {
  const dates = [];
  for (const rawText of flattenStrings(value)) {
    const text = String(focusPeriodText(rawText) || rawText);

    // 1. Slash-form fiscal period e.g., FY2025/3-FY2027/3, 2026/4-2027/4, 2027/3
    for (const match of text.matchAll(/(?:FY)?\s*(20\d{2})\s*[\/.-]\s*(1[0-2]|0?[1-9])\b/gi)) {
      const date = monthEnd(match[1], match[2]);
      if (date) dates.push({ date, basis: match[0], precision: 'slash_fiscal_month' });
    }

    // 2. Year-month e.g., 2027年3月期
    for (const match of text.matchAll(/(20\d{2})年\s*(1[0-2]|0?[1-9])月期/g)) {
      const date = monthEnd(match[1], match[2]);
      if (date) dates.push({ date, basis: match[0], precision: 'month_end' });
    }

    // 3. Fiscal year label e.g., 2027年度
    for (const match of text.matchAll(/(20\d{2})年度/g)) {
      const date = toIsoDate(Number(match[1]) + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'fiscal_year' });
    }

    // 4. FY full year label e.g., FY2027 (not followed by /month)
    for (const match of text.matchAll(/\bFY\s*(20\d{2})\b(?!\s*[\/.-]\s*\d)/gi)) {
      const date = toIsoDate(Number(match[1]) + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'fy_label' });
    }

    // 5. Unambiguous 2-digit FY labels between 24 and 35 e.g. FY25 (meaning 2025)
    for (const match of text.matchAll(/\bFY\s*([2-3][0-5])\b(?!\s*[\/.-]\s*\d)/gi)) {
      const year = 2000 + Number(match[1]);
      const date = toIsoDate(year + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'fy_2digit_label' });
    }

    // 6. Range end year e.g. 2025-2027
    for (const match of text.matchAll(/(?:20\d{2})[-~～─](20\d{2})/g)) {
      const date = toIsoDate(Number(match[1]) + 1, 3, 31);
      if (date) dates.push({ date, basis: match[0], precision: 'range_end_year' });
    }
  }
  return dates;
}

export function resolveCompanyStatus(listing, previous, primaryReviewed, verified) {
  const autoDerivedMethods = new Set([
    'quality_rebase_phase2_independent_completion_v1',
    'quality_rebase_primary_review_l1_seed_v1',
  ]);

  const code = String(listing.code);
  const previousIsAutoDerived = autoDerivedMethods.has(previous?.review?.method);

  let selected = previousIsAutoDerived ? null : previous;
  let selectedDerivation = previousIsAutoDerived ? null : (previous?.derivation || null);

  const manualPreviousIsNewerThan = seed => {
    const previousCheckedAt = String(previous?.review?.checkedAt || '');
    const seedCheckedAt = String(seed?.review?.checkedAt || '');
    return (
      previous
      && !previousIsAutoDerived
      && RESOLVED_STATUSES.has(previous.status)
      && validDate(previousCheckedAt)
      && validDate(seedCheckedAt)
      && previousCheckedAt > seedCheckedAt
    );
  };

  if (primaryReviewed && !manualPreviousIsNewerThan(primaryReviewed)) {
    selected = primaryReviewed;
    selectedDerivation = primaryReviewed.derivation || null;
  }

  if (verified && !manualPreviousIsNewerThan(verified)) {
    selected = verified;
    selectedDerivation = verified.derivation || null;
  }

  const status = selected?.status || 'not_checked';
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error(`Invalid plan detection status for ${code}: ${status}`);
  }

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

  if (RESOLVED_STATUSES.has(status)) {
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
}
