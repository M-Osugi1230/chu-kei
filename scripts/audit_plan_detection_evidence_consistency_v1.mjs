#!/usr/bin/env node
/**
 * Read-only consistency audit. Does not change registry, evidence, or release data.
 * Usage: node scripts/audit_plan_detection_evidence_consistency_v1.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const summary = read('site/data/plan-detection-summary-v1.json');
const evidence = read('docs/ADE_COVERAGE_FULL_COMPLETION.json');
const issues = [];
const check = (condition, message) => { if (!condition) issues.push(message); };
const integer = (value) => Number.isInteger(value) && value >= 0;

for (const [name, value] of Object.entries({
  'summary.companyCount': summary.companyCount,
  'summary.resolvedCount': summary.resolvedCount,
  'summary.pendingCount': summary.pendingCount,
  'evidence.company_count': evidence.company_count,
  'evidence.final_resolved_count': evidence.final_resolved_count,
})) check(integer(value), `${name} must be a non-negative integer`);

check(summary.companyCount === summary.resolvedCount + summary.pendingCount,
  'summary resolved + pending must equal company count');
check(summary.companyCount === evidence.company_count,
  'summary and evidence company universes differ');
check(summary.resolvedCount === evidence.final_resolved_count,
  'summary resolved count disagrees with completion evidence');
check(summary.pendingCount === (evidence.counts?.not_checked ?? null),
  'summary pending count disagrees with completion evidence not_checked');
check(summary.primaryReviewedOverrideCount === evidence.overrides?.primary_reviewed_override_count,
  'primary-reviewed override counts disagree');
check(summary.verifiedOverrideCount === evidence.overrides?.verified_override_count,
  'verified override counts disagree');

if (evidence.status === 'COMPLETE') {
  check(evidence.final_resolved_count === evidence.company_count,
    'COMPLETE evidence does not cover its own universe');
  check(summary.pendingCount === 0,
    'COMPLETE evidence contradicts the public pending-company count');
}

const report = {
  audit: 'plan-detection-evidence-consistency-v1',
  readOnly: true,
  scope: 'public summary versus completion evidence; not registry row-level or live-site verification',
  summary: {
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
