import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  toIsoDate,
  monthEnd,
  validDate,
  validUrl,
  focusPeriodText,
  extractEndDates,
  resolveCompanyStatus,
  validateCandidateBatchPayload,
  validateCandidateFile,
} from '../scripts/lib/plan_detection_v1.mjs';

// ============================================================================
// TESTS SUITE 1: Candidate Validation Logic (Using Production Functions)
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
// TESTS SUITE 2: Registry Build Logic (Using Production Functions)
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
// TESTS SUITE 3: Execution of Production Entry Points and Workspace Data
// ============================================================================

test('Production Entry Point - validate_plan_detection_candidates_v1.mjs runs cleanly', () => {
  const output = execFileSync('node', ['scripts/validate_plan_detection_candidates_v1.mjs'], {
    encoding: 'utf8',
    cwd: path.resolve('.'),
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.schemaVersion, 'plan-detection-candidate-batch-v1');
  assert.equal(parsed.nonPublic, true);
  assert.equal(parsed.automaticPromotionAllowed, false);
});

test('Production Entry Point - build_plan_detection_registry_v1.mjs runs cleanly', () => {
  const output = execFileSync('node', ['scripts/build_plan_detection_registry_v1.mjs'], {
    encoding: 'utf8',
    cwd: path.resolve('.'),
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.version, 'plan-detection-summary-v1');
  assert.ok(typeof parsed.companyCount === 'number');
  assert.ok(typeof parsed.resolvedCount === 'number');
  assert.ok(typeof parsed.detectionCoverage === 'number');
});

test('Workspace Candidates Data - Existing candidate files pass candidate validation module', () => {
  const candidatesDir = path.resolve('operations/plan-detection/candidates');
  if (!fs.existsSync(candidatesDir)) return;

  const entries = fs.readdirSync(candidatesDir, { withFileTypes: true });
  const seenCodes = new Set();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const folderName = entry.name;
      const file = path.join(candidatesDir, folderName, 'candidates-v1.json');
      if (fs.existsSync(file)) {
        assert.doesNotThrow(() => {
          validateCandidateFile(file, seenCodes);
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
