import { test, expect } from '@playwright/test';
import { buildQualityChecks } from '../../scripts/lib/quality_profile_v2.mjs';

const baseCompany = {
  stage: 'detailed_extracted',
  sourceUrl: 'https://example.com/ir/strategy/',
  planPublishedDate: '2026-01-01',
  evidenceRefs: [
    '公式Webページ（見出し: 中期経営方針）: 固定の最終年度目標を置かず、事業環境に応じて方針を更新する。',
  ],
  summary: '公式中期経営方針の主要論点と定量・定性方針を構造化した企業データ。',
  themes: ['事業戦略'],
  revenue: '固定の売上高目標は未開示',
  profit: '固定の利益額目標は未開示',
  flags: { progress: false },
};

test('accepts a grounded non-comparable assessment as completed progress evaluation', () => {
  const checks = buildQualityChecks({
    ...baseCompany,
    progressAssessment: {
      status: 'not_comparable',
      reason: '公式資料はCAGRとレンジのみを示し、固定目標と確定実績を同一定義で接続できないため。',
      sourceRef: '公式Webページ（見出し: 財務方針）',
    },
  });

  expect(checks.progressConnected).toBe(true);
});

test('does not treat a missing or weak assessment as completed', () => {
  expect(buildQualityChecks(baseCompany).progressConnected).toBe(false);
  expect(buildQualityChecks({
    ...baseCompany,
    progressAssessment: {
      status: 'not_comparable',
      reason: '比較不能',
      sourceRef: '',
    },
  }).progressConnected).toBe(false);
});

test('keeps actual connected progress compatible', () => {
  expect(buildQualityChecks({
    ...baseCompany,
    flags: { progress: true },
  }).progressConnected).toBe(true);
});
