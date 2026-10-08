import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// --- Functions replicated for pure unit testing of Candidate Validation Logic ---

const ALLOWED_CANDIDATE_STATUSES = new Set([
  'current',
  'expired',
  'found_unstructured',
  'not_checked',
]);

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function isDateString(val) {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function isHttpsUrl(val) {
  return typeof val === 'string' && val.startsWith('https://');
}

function isPlainObject(val) {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function validateCandidateBatchPayload(file, payload, folderName, seenCodes = new Set()) {
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

// --- Functions replicated for pure unit testing of Registry Build Logic ---

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

function extractEndDates(value) {
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

function resolveCompanyStatus(listing, previous, primaryReviewed, verified) {
  const REGISTRY_STATUSES = new Set([
    'current',
    'expired',
    'no_formal_plan',
    'found_unstructured',
    'not_checked',
  ]);
  const RESOLVED = new Set(['current', 'expired', 'no_formal_plan', 'found_unstructured']);
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

  if (verified && !manualPreviousIsNewerThan(verified)) {
    selected = verified;
    selectedDerivation = verified.derivation || null;
  }

  const status = selected?.status || 'not_checked';
  if (!REGISTRY_STATUSES.has(status)) {
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
}

// ============================================================================
// TESTS SUITE 1: Candidate Validation Logic Unit Tests
// ============================================================================

test('Plan Detection Candidate Validation - Valid Batch passes validation', () => {
  const validPayload = {
    schemaVersion: 'plan-detection-candidate-batch-v1',
    batchId: 'test-batch-001',
    checkedAt: '2026-10-08',
    nonPublic: true,
    policy: {
      humanReviewRequired: true,
      automaticPromotionAllowed: false,
      publicationAllowed: false,
      inferNoFormalPlanFromMissingEvidence: false,
      finalRegistryMutationAllowed: false,
      allowedSuggestedStatuses: ['current', 'expired'],
    },
    candidates: [
      {
        code: '1001',
        name: 'Test Company 1',
        source: {
          authority: 'official_primary',
          url: 'https://example.com/ir/plan.pdf',
          publishedDate: '2026-04-01',
        },
        observation: {
          suggestedStatus: 'current',
          exactPlanEndDate: '2028-03-31',
        },
        review: {
          decision: 'needs_review',
          status: 'pending',
          requiredChecks: ['Verify IR document'],
        },
        publication: {
          eligible: false,
        },
        promotion: {
          allowed: false,
        },
        provenance: {
          repositoryPaths: ['operations/plan-detection/candidates/test-batch-001/candidates-v1.json'],
        },
      },
    ],
  };

  assert.doesNotThrow(() => {
    validateCandidateBatchPayload('test-file.json', validPayload, 'test-batch-001');
  });
});

test('Plan Detection Candidate Validation - Rejects non-object root payload', () => {
  assert.throws(() => {
    validateCandidateBatchPayload('test-file.json', 'not-an-object', 'test-batch-001');
  }, /root payload must be an object/);
});

test('Plan Detection Candidate Validation - Rejects invalid schemaVersion', () => {
  const payload = {
    schemaVersion: 'plan-detection-candidate-batch-v0',
    batchId: 'test-batch-001',
    nonPublic: true,
  };
  assert.throws(() => {
    validateCandidateBatchPayload('test-file.json', payload, 'test-batch-001');
  }, /unsupported schemaVersion/);
});

test('Plan Detection Candidate Validation - Rejects batchId mismatch with folder name', () => {
  const payload = {
    schemaVersion: 'plan-detection-candidate-batch-v1',
    batchId: 'test-batch-001',
    nonPublic: true,
  };
  assert.throws(() => {
    validateCandidateBatchPayload('test-file.json', payload, 'mismatched-folder');
  }, /batchId 'test-batch-001' must match directory name 'mismatched-folder'/);
});

test('Plan Detection Candidate Validation - Rejects nonPublic === false', () => {
  const payload = {
    schemaVersion: 'plan-detection-candidate-batch-v1',
    batchId: 'test-batch-001',
    nonPublic: false,
  };
  assert.throws(() => {
    validateCandidateBatchPayload('test-file.json', payload, 'test-batch-001');
  }, /candidate batches must remain non-public/);
});

test('Plan Detection Candidate Validation - Policy constraints validation', () => {
  const basePayload = {
    schemaVersion: 'plan-detection-candidate-batch-v1',
    batchId: 'test-batch-001',
    nonPublic: true,
    policy: {
      humanReviewRequired: true,
      automaticPromotionAllowed: false,
      publicationAllowed: false,
      inferNoFormalPlanFromMissingEvidence: false,
      finalRegistryMutationAllowed: false,
    },
    candidates: [],
  };

  // 1. Missing policy object
  assert.throws(() => {
    validateCandidateBatchPayload('test.json', { ...basePayload, policy: null }, 'test-batch-001');
  }, /policy object is required/);

  // 2. humanReviewRequired must be true
  assert.throws(() => {
    validateCandidateBatchPayload('test.json', {
      ...basePayload,
      policy: { ...basePayload.policy, humanReviewRequired: false },
    }, 'test-batch-001');
  }, /human review must be required/);

  // 3. automaticPromotionAllowed must be false
  assert.throws(() => {
    validateCandidateBatchPayload('test.json', {
      ...basePayload,
      policy: { ...basePayload.policy, automaticPromotionAllowed: true },
    }, 'test-batch-001');
  }, /automatic promotion must be disabled/);

  // 4. publicationAllowed must be false
  assert.throws(() => {
    validateCandidateBatchPayload('test.json', {
      ...basePayload,
      policy: { ...basePayload.policy, publicationAllowed: true },
    }, 'test-batch-001');
  }, /publication must be disabled/);

  // 5. inferNoFormalPlanFromMissingEvidence must be false
  assert.throws(() => {
    validateCandidateBatchPayload('test.json', {
      ...basePayload,
      policy: { ...basePayload.policy, inferNoFormalPlanFromMissingEvidence: true },
    }, 'test-batch-001');
  }, /missing evidence must never imply no formal plan/);

  // 6. allowedSuggestedStatuses contains forbidden 'no_formal_plan'
  assert.throws(() => {
    validateCandidateBatchPayload('test.json', {
      ...basePayload,
      policy: { ...basePayload.policy, allowedSuggestedStatuses: ['current', 'no_formal_plan'] },
    }, 'test-batch-001');
  }, /forbidden or invalid status 'no_formal_plan'/);
});

test('Plan Detection Candidate Validation - Rejects no_formal_plan as candidate suggestedStatus', () => {
  const payload = {
    schemaVersion: 'plan-detection-candidate-batch-v1',
    batchId: 'test-batch-001',
    nonPublic: true,
    policy: {
      humanReviewRequired: true,
      automaticPromotionAllowed: false,
      publicationAllowed: false,
      inferNoFormalPlanFromMissingEvidence: false,
      finalRegistryMutationAllowed: false,
    },
    candidates: [
      {
        code: '1001',
        name: 'Test Company',
        source: { authority: 'official_primary', url: 'https://example.com/plan.pdf', publishedDate: '2026-01-01' },
        observation: { suggestedStatus: 'no_formal_plan' },
        review: { decision: 'needs_review', status: 'pending', requiredChecks: ['Check'] },
        publication: { eligible: false },
        promotion: { allowed: false },
        provenance: { repositoryPaths: ['operations/test.json'] },
      },
    ],
  };

  assert.throws(() => {
    validateCandidateBatchPayload('test-file.json', payload, 'test-batch-001');
  }, /suggestedStatus is not allowed/);
});

test('Plan Detection Candidate Validation - Rejects non-HTTPS source URLs', () => {
  const payload = {
    schemaVersion: 'plan-detection-candidate-batch-v1',
    batchId: 'test-batch-001',
    nonPublic: true,
    policy: {
      humanReviewRequired: true,
      automaticPromotionAllowed: false,
      publicationAllowed: false,
      inferNoFormalPlanFromMissingEvidence: false,
      finalRegistryMutationAllowed: false,
    },
    candidates: [
      {
        code: '1001',
        name: 'Test Company',
        source: { authority: 'official_primary', url: 'http://example.com/plan.pdf', publishedDate: '2026-01-01' },
        observation: { suggestedStatus: 'current' },
        review: { decision: 'needs_review', status: 'pending', requiredChecks: ['Check'] },
        publication: { eligible: false },
        promotion: { allowed: false },
        provenance: { repositoryPaths: ['operations/test.json'] },
      },
    ],
  };

  assert.throws(() => {
    validateCandidateBatchPayload('test-file.json', payload, 'test-batch-001');
  }, /source URL must be HTTPS/);
});

test('Plan Detection Candidate Validation - Rejects unsafe repository provenance paths', () => {
  const makePayload = repoPath => ({
    schemaVersion: 'plan-detection-candidate-batch-v1',
    batchId: 'test-batch-001',
    nonPublic: true,
    policy: {
      humanReviewRequired: true,
      automaticPromotionAllowed: false,
      publicationAllowed: false,
      inferNoFormalPlanFromMissingEvidence: false,
      finalRegistryMutationAllowed: false,
    },
    candidates: [
      {
        code: '1001',
        name: 'Test Company',
        source: { authority: 'official_primary', url: 'https://example.com/plan.pdf', publishedDate: '2026-01-01' },
        observation: { suggestedStatus: 'current' },
        review: { decision: 'needs_review', status: 'pending', requiredChecks: ['Check'] },
        publication: { eligible: false },
        promotion: { allowed: false },
        provenance: { repositoryPaths: [repoPath] },
      },
    ],
  });

  // Leading slash
  assert.throws(() => {
    validateCandidateBatchPayload('test.json', makePayload('/etc/passwd'), 'test-batch-001');
  }, /invalid or unsafe/);

  // Path traversal
  assert.throws(() => {
    validateCandidateBatchPayload('test.json', makePayload('../operations/test.json'), 'test-batch-001');
  }, /invalid or unsafe/);
});

test('Plan Detection Candidate Validation - Rejects duplicate candidate codes', () => {
  const payload = {
    schemaVersion: 'plan-detection-candidate-batch-v1',
    batchId: 'test-batch-001',
    nonPublic: true,
    policy: {
      humanReviewRequired: true,
      automaticPromotionAllowed: false,
      publicationAllowed: false,
      inferNoFormalPlanFromMissingEvidence: false,
      finalRegistryMutationAllowed: false,
    },
    candidates: [
      {
        code: '1001',
        name: 'Company 1',
        source: { authority: 'official_primary', url: 'https://example.com/1.pdf', publishedDate: '2026-01-01' },
        observation: { suggestedStatus: 'current' },
        review: { decision: 'needs_review', status: 'pending', requiredChecks: ['Check'] },
        publication: { eligible: false },
        promotion: { allowed: false },
        provenance: { repositoryPaths: ['operations/test.json'] },
      },
      {
        code: '1001',
        name: 'Company 1 Duplicate',
        source: { authority: 'official_primary', url: 'https://example.com/2.pdf', publishedDate: '2026-01-01' },
        observation: { suggestedStatus: 'current' },
        review: { decision: 'needs_review', status: 'pending', requiredChecks: ['Check'] },
        publication: { eligible: false },
        promotion: { allowed: false },
        provenance: { repositoryPaths: ['operations/test.json'] },
      },
    ],
  };

  assert.throws(() => {
    validateCandidateBatchPayload('test-file.json', payload, 'test-batch-001');
  }, /duplicate candidate code 1001/);
});

// ============================================================================
// TESTS SUITE 2: Registry Build Logic Unit Tests
// ============================================================================

test('Plan Detection Registry - Date helper functions toIsoDate and monthEnd', () => {
  assert.equal(toIsoDate(2027, 3, 31), '2027-03-31');
  assert.equal(toIsoDate(2028, 2, 29), '2028-02-29'); // Leap year
  assert.equal(toIsoDate(2027, 2, 29), null); // Invalid date (not leap year)

  assert.equal(monthEnd(2027, 3), '2027-03-31');
  assert.equal(monthEnd(2026, 4), '2026-04-30');
  assert.equal(monthEnd(2028, 2), '2028-02-29');
});

test('Plan Detection Registry - Date and URL format validators', () => {
  assert.equal(validDate('2026-10-08'), true);
  assert.equal(validDate('2026/10/08'), false);
  assert.equal(validDate('invalid'), false);

  assert.equal(validUrl('https://example.com/plan.pdf'), true);
  assert.equal(validUrl('http://example.com/plan.pdf'), true);
  assert.equal(validUrl('ftp://example.com/plan.pdf'), false);
  assert.equal(validUrl('not-a-url'), false);
});

test('Plan Detection Registry - focusPeriodText extracts mid-term segment over long-term vision', () => {
  const input = '中期経営計画 GOOD FOODS Recipe2 (2025年度～2027年度) （長期ビジョン2030）';
  const focused = focusPeriodText(input);
  assert.equal(focused.includes('長期ビジョン'), false);
  assert.equal(focused.includes('GOOD FOODS Recipe2'), true);
});

test('Plan Detection Registry - extractEndDates date parsing rules', () => {
  // Rule 1: Slash-form fiscal period
  const r1 = extractEndDates('FY2025/3-FY2027/3');
  assert.ok(r1.some(d => d.date === '2027-03-31' && d.precision === 'slash_fiscal_month'));

  const r1b = extractEndDates('2026/4-2027/4');
  assert.ok(r1b.some(d => d.date === '2027-04-30' && d.precision === 'slash_fiscal_month'));

  // Rule 2: Year-month
  const r2 = extractEndDates('2027年3月期');
  assert.ok(r2.some(d => d.date === '2027-03-31' && d.precision === 'month_end'));

  // Rule 3: Fiscal year label
  const r3 = extractEndDates('2027年度');
  assert.ok(r3.some(d => d.date === '2028-03-31' && d.precision === 'fiscal_year'));

  // Rule 4: FY full year label
  const r4 = extractEndDates('FY2027');
  assert.ok(r4.some(d => d.date === '2028-03-31' && d.precision === 'fy_label'));

  // Rule 5: 2-digit FY label (e.g. FY25)
  const r5 = extractEndDates('FY25');
  assert.ok(r5.some(d => d.date === '2026-03-31' && d.precision === 'fy_2digit_label'));

  // Rule 6: Range end year
  const r6 = extractEndDates('2025-2027');
  assert.ok(r6.some(d => d.date === '2028-03-31' && d.precision === 'range_end_year'));

  // Ambiguous 2-digit FY labels (e.g. FY76-FY80) MUST be rejected
  const ambiguous = extractEndDates('新中長期経営計画ローリングプラン(FY76-FY80)');
  assert.equal(ambiguous.length, 0);
});

test('Plan Detection Registry - Overrides and status resolution hierarchy', () => {
  const listing = { code: '1001', name: 'Test Co', market: 'Prime', industry: 'Tech' };

  // 1. Default without any overrides defaults to not_checked
  const resDefault = resolveCompanyStatus(listing, null, null, null);
  assert.equal(resDefault.status, 'not_checked');

  // 2. Primary reviewed override applies when no verified override exists
  const primaryOverride = {
    code: '1001',
    status: 'current',
    review: { checkedAt: '2026-05-01', sourceUrl: 'https://example.com/primary.pdf' },
  };
  const resPrimary = resolveCompanyStatus(listing, null, primaryOverride, null);
  assert.equal(resPrimary.status, 'current');
  assert.equal(resPrimary.review.sourceUrl, 'https://example.com/primary.pdf');

  // 3. Verified override takes precedence over primary reviewed override
  const verifiedOverride = {
    code: '1001',
    status: 'expired',
    review: { checkedAt: '2026-06-01', sourceUrl: 'https://example.com/verified.pdf' },
  };
  const resVerified = resolveCompanyStatus(listing, null, primaryOverride, verifiedOverride);
  assert.equal(resVerified.status, 'expired');
  assert.equal(resVerified.review.sourceUrl, 'https://example.com/verified.pdf');

  // 4. Manual previous review with newer checkedAt date takes precedence over seed override
  const manualPrevious = {
    code: '1001',
    status: 'current',
    review: {
      checkedAt: '2026-07-01',
      sourceUrl: 'https://example.com/manual.pdf',
      method: 'manual_l1_review_v1',
    },
  };
  const resManual = resolveCompanyStatus(listing, manualPrevious, primaryOverride, verifiedOverride);
  assert.equal(resManual.status, 'current');
  assert.equal(resManual.review.sourceUrl, 'https://example.com/manual.pdf');
});

test('Plan Detection Registry - Rejects resolved status without valid checkedAt or sourceUrl', () => {
  const listing = { code: '1001', name: 'Test Co', market: 'Prime', industry: 'Tech' };

  // Missing sourceUrl
  const invalidUrlOverride = {
    code: '1001',
    status: 'current',
    review: { checkedAt: '2026-05-01', sourceUrl: 'invalid-url' },
  };
  assert.throws(() => {
    resolveCompanyStatus(listing, null, invalidUrlOverride, null);
  }, /Resolved status requires sourceUrl/);

  // Missing checkedAt
  const invalidDateOverride = {
    code: '1001',
    status: 'current',
    review: { checkedAt: null, sourceUrl: 'https://example.com/plan.pdf' },
  };
  assert.throws(() => {
    resolveCompanyStatus(listing, null, invalidDateOverride, null);
  }, /Resolved status requires checkedAt/);
});

// ============================================================================
// TESTS SUITE 3: Real Workspace Data Verification Tests
// ============================================================================

test('Workspace Candidates Data - Existing candidate files pass candidate validation', () => {
  const candidatesDir = path.resolve('operations/plan-detection/candidates');
  if (!fs.existsSync(candidatesDir)) return;

  const entries = fs.readdirSync(candidatesDir, { withFileTypes: true });
  const seenCodes = new Set();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const folderName = entry.name;
      const file = path.join(candidatesDir, folderName, 'candidates-v1.json');
      if (fs.existsSync(file)) {
        const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.doesNotThrow(() => {
          validateCandidateBatchPayload(file, payload, folderName, seenCodes);
        });
      }
    }
  }
});

test('Workspace Registry Data - Regression Assertions for specific stock codes', () => {
  const registryPath = path.resolve('operations/plan-detection/registry-v1.json');
  if (!fs.existsSync(registryPath)) return;

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(registry.version, 'plan-detection-registry-v1');
  assert.ok(Array.isArray(registry.companies));

  const companyMap = new Map(registry.companies.map(c => [String(c.code), c]));

  // 1. 3173 must remain not_checked (L1 review gate)
  const c3173 = companyMap.get('3173');
  if (c3173) {
    assert.equal(c3173.status, 'not_checked');
  }

  // 2. 1381 and 1418 must remain not_checked
  const c1381 = companyMap.get('1381');
  if (c1381) {
    assert.equal(c1381.status, 'not_checked');
  }
  const c1418 = companyMap.get('1418');
  if (c1418) {
    assert.equal(c1418.status, 'not_checked');
  }

  // 3. 1332 plan end date calculation precedence
  const dates1332 = extractEndDates('中期経営計画 GOOD FOODS Recipe2 (2025年度～2027年度) （長期ビジョン2030）');
  dates1332.sort((a, b) => a.date.localeCompare(b.date));
  const planEnd1332 = dates1332.at(-1);
  assert.ok(planEnd1332);
  assert.equal(planEnd1332.date, '2028-03-31');
});
