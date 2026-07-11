export const LEGACY_SAVED_KEY = 'chukei.savedCompanies.v1';
export const SAVED_RESEARCH_KEY = 'chukei.savedResearch.v2';

function validCode(value) {
  return /^[0-9A-Z]{4}$/.test(String(value ?? ''));
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

function validDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function loadSavedResearch(storage, companyByCode, now = new Date().toISOString()) {
  let legacy = [];
  let parsed = null;
  try {
    const value = JSON.parse(storage.getItem(LEGACY_SAVED_KEY) || '[]');
    legacy = Array.isArray(value) ? value : [];
  } catch {
    legacy = [];
  }
  try {
    parsed = JSON.parse(storage.getItem(SAVED_RESEARCH_KEY) || 'null');
  } catch {
    parsed = null;
  }

  const storedCompanies = parsed?.version === 2 && parsed.companies && typeof parsed.companies === 'object'
    ? parsed.companies
    : {};
  const result = new Map();
  for (const rawCode of legacy) {
    const code = String(rawCode).toUpperCase();
    const company = companyByCode.get(code);
    if (!validCode(code) || !company) continue;
    const existing = storedCompanies[code] ?? {};
    result.set(code, {
      savedAt: validDateTime(existing.savedAt) ? existing.savedAt : now,
      lastSeenVerifiedDate: validDate(existing.lastSeenVerifiedDate)
        ? existing.lastSeenVerifiedDate
        : (validDate(company.lastVerifiedDate) ? company.lastVerifiedDate : null),
    });
  }
  return result;
}

export function persistSavedResearch(storage, metadata) {
  const companies = Object.fromEntries([...metadata.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ja'))
    .map(([code, value]) => [code, {
      savedAt: value.savedAt,
      lastSeenVerifiedDate: value.lastSeenVerifiedDate ?? null,
    }]));
  storage.setItem(SAVED_RESEARCH_KEY, JSON.stringify({ version: 2, companies }));
  storage.setItem(LEGACY_SAVED_KEY, JSON.stringify(Object.keys(companies)));
}

export function syncSavedResearch(metadata, legacyCodes, companyByCode, now = new Date().toISOString()) {
  const next = new Map();
  for (const rawCode of legacyCodes) {
    const code = String(rawCode).toUpperCase();
    const company = companyByCode.get(code);
    if (!validCode(code) || !company) continue;
    const existing = metadata.get(code);
    next.set(code, existing ?? {
      savedAt: now,
      lastSeenVerifiedDate: validDate(company.lastVerifiedDate) ? company.lastVerifiedDate : null,
    });
  }
  return next;
}

export function hasSavedUpdate(metadata, company) {
  if (!metadata || !validDate(company?.lastVerifiedDate)) return false;
  if (!validDate(metadata.lastSeenVerifiedDate)) return false;
  return company.lastVerifiedDate > metadata.lastSeenVerifiedDate;
}

export function markSavedSeen(metadata, company) {
  const current = metadata.get(company.code);
  if (!current) return false;
  const nextDate = validDate(company.lastVerifiedDate) ? company.lastVerifiedDate : current.lastSeenVerifiedDate;
  if (nextDate === current.lastSeenVerifiedDate) return false;
  metadata.set(company.code, { ...current, lastSeenVerifiedDate: nextDate });
  return true;
}

export function countSavedUpdates(metadata, companyByCode) {
  let count = 0;
  for (const [code, value] of metadata) {
    if (hasSavedUpdate(value, companyByCode.get(code))) count += 1;
  }
  return count;
}
