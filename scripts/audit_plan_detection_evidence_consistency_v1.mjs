#!/usr/bin/env node
/**
 * Read-only audit of canonical Plan Detection, public data, and completion claims.
 *
 * Usage: node scripts/audit_plan_detection_evidence_consistency_v1.mjs
 *
 * This does not review companies, grant approval, or edit production data.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const universe = read('operations/universe/current-universe-v1.json');
const registry = read('operations/plan-detection/registry-v1.json');
const summary = read('site/data/plan-detection-summary-v1.json');
const evidence = read('docs/ADE_COVERAGE_FULL_COMPLETION.json');

const statuses = ['current', 'expired', 'no_formal_plan', 'found_unstructured', 'not_checked'];
const resolvedStatuses = statuses.filter((status) => status !== 'not_checked');
const issues = [];
const check = (condition, message) => { if (!condition) issues.push(message); };
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const close = (left, right) => Number.isFinite(left)
  && Number.isFinite(right) && Math.abs(left - right) < 0.000002;

const universeCompanies = Array.isArray(universe.companies) ? universe.companies : [];
const registryCompanies = Array.isArray(registry.companies) ? registry.companies : [];
const universeCodes = new Set(universeCompanies.map((company) => String(company.code)));
const registryCodes = new Set(registryCompanies.map((company) => String(company.code)));
const actual = Object.fromEntries(statuses.map((status) => [status, 0]));

for (const company of registryCompanies) {
  if (Object.hasOwn(actual, company.status)) actual[company.status] += 1;
  else issues.push(`unknown status for ${String(company.code)}: ${String(company.status)}`);
}

check(universe.version === 'company-universe-v1', 'unexpected universe version');
check(registry.version === 'plan-detection-registry-v1', 'unexpected registry version');
check(summary.version === 'plan-detection-summary-v1', 'unexpected public summary version');
check(universeCodes.size === universeCompanies.length, 'duplicate company codes in universe');
check(registryCodes.size === registryCompanies.length, 'duplicate company codes in registry');
check(universeCodes.size === registryCodes.size
  && [...universeCodes].every((code) => registryCodes.has(code)),
'registry company codes differ from universe');

const actualResolved = resolvedStatuses.reduce((sum, status) => sum + actual[status], 0);
const actualPending = actual.not_checked;
const actualCoverage = registryCompanies.length > 0
  ? actualResolved / registryCompanies.length : 0;

for (const [name, value] of Object.entries({
  'universe.companyCount': universe.companyCount,
  'registry.companyCount': registry.companyCount,
  'registry.resolvedCount': registry.resolvedCount,
  'summary.companyCount': summary.companyCount,
  'summary.resolvedCount': summary.resolvedCount,
  'summary.pendingCount': summary.pendingCount,
})) check(nonNegativeInteger(value), `${name} must be a non-negative integer`);

check(universe.companyCount === universeCompanies.length, 'universe declared company count differs from rows');
check(registry.companyCount === registryCompanies.length, 'registry declared company count differs from rows');
check(registry.resolvedCount === actualResolved, 'registry declared resolved count differs from rows');
check(summary.companyCount === registryCompanies.length, 'public universe count differs from canonical rows');
check(summary.resolvedCount === actualResolved, 'public resolved count differs from canonical rows');
check(summary.pendingCount === actualPending, 'public pending count differs from canonical rows');
check(summary.companyCount === summary.resolvedCount + summary.pendingCount,
  'public resolved + pending must equal company count');
check(close(summary.detectionCoverage, actualCoverage),
  'public coverage fraction differs from canonical rows');
check(close(registry.detectionCoverage, actualCoverage),
  'registry coverage fraction differs from canonical rows');

for (const status of statuses) {
  check(registry.counts?.[status] === actual[status], `registry counts.${status} differs from rows`);
  check(summary.counts?.[status] === actual[status], `public counts.${status} differs from rows`);
}

for (const field of ['verifiedOverrideCount', 'primaryReviewedOverrideCount']) {
  check(summary[field] === registry[field], `public ${field} differs from registry`);
}

check(['COMPLETE', 'INVALIDATED'].includes(evidence.status),
  'unexpected full-completion evidence status');

if (evidence.status === 'COMPLETE') {
  check(evidence.company_count === registryCompanies.length,
    'COMPLETE claim universe differs from canonical registry');
  check(actualPending === 0, 'COMPLETE claim has unresolved canonical companies');
  check(actualResolved === registryCompanies.length,
    'COMPLETE claim does not cover every canonical company');
  check(evidence.final_resolved_count === actualResolved,
    'COMPLETE claim resolved count differs from canonical rows');
  check(close(evidence.coverage, 1), 'COMPLETE claim coverage must be 100%');
  check(evidence.counts?.not_checked === 0, 'COMPLETE claim has a pending count');
  check(evidence.overrides?.verified_override_count === registry.verifiedOverrideCount,
    'COMPLETE verified overrides differ from canonical registry');
  check(evidence.overrides?.primary_reviewed_override_count === registry.primaryReviewedOverrideCount,
    'COMPLETE primary-review overrides differ from canonical registry');
  for (const company of registryCompanies) {
    check(Boolean(company.review?.checkedAt && company.review?.sourceUrl),
      `COMPLETE claim lacks checked source evidence for ${String(company.code)}`);
  }
} else if (evidence.status === 'INVALIDATED') {
  const snapshotPending = evidence.counts?.not_checked;
  check(evidence.retraction?.original_claim?.status === 'COMPLETE',
    'INVALIDATED marker lacks preserved original completion claim');
  check(nonNegativeInteger(snapshotPending), 'invalidated snapshot pending count invalid');
  check(evidence.final_resolved_count === evidence.company_count - snapshotPending,
    'invalidated snapshot counts do not add up');
  check(close(evidence.coverage, evidence.final_resolved_count / evidence.company_count),
    'invalidated snapshot coverage fraction is inconsistent');
  // Historical, retracted evidence is intentionally NOT required to match
  // the latest registry as genuine company reviews are completed over time.
}

const report = {
  audit: 'plan-detection-evidence-consistency-v1',
  readOnly: true,
  scope: 'canonical row counts, universe identity, public summary, completion-claim safety; not live-site verification',
  canonical: {
    companyCount: registryCompanies.length,
    resolvedCount: actualResolved,
    pendingCount: actualPending,
    coverage: Number(actualCoverage.toFixed(6)),
    counts: actual,
  },
  publicSummary: {
    companyCount: summary.companyCount,
    resolvedCount: summary.resolvedCount,
    pendingCount: summary.pendingCount,
  },
  completionEvidence: {
    status: evidence.status,
    companyCount: evidence.company_count,
    resolvedCount: evidence.final_resolved_count,
  },
  passed: issues.length === 0,
  issues,
};
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exitCode = 1;
