import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '3021', name: "パシフィックネット" },
  { code: '3370', name: "フジタコーポレーション" },
  { code: '3372', name: "関門海" },
  { code: '3547', name: "ユニシアホールディングス" },
  { code: '3845', name: "アイフリークモバイル" },
  { code: '3851', name: "日本一ソフトウェア" },
  { code: '4317', name: "レイ" },
  { code: '4743', name: "アイティフォー" },
  { code: '4839', name: "ＷＯＷＯＷ" },
  { code: '4927', name: "ポーラ・オルビスホールディングス" },
  { code: '6195', name: "ホープ" },
  { code: '6366', name: "千代田化工建設" },
  { code: '6436', name: "アマノ" },
  { code: '6440', name: "ＪＵＫＩ" },
  { code: '6469', name: "放電精密加工研究所" },
  { code: '6800', name: "ヨコオ" },
  { code: '6823', name: "リオン" },
  { code: '6867', name: "リーダー電子" },
  { code: '6904', name: "原田工業" },
  { code: '6920', name: "レーザーテック" },
  { code: '8153', name: "モスフードサービス" },
  { code: '8410', name: "セブン銀行" },
  { code: '9842', name: "アークランズ" },
];

test('keeps at least 2994 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(23);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(23);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('3000社');
  await expect(page.locator('#stat-confirmed')).toHaveText('2994社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(2994);
});

test('exposes every structured-expansion-batch-89 company through search and detail', async ({ page }) => {
  await page.goto('/');
  for (const company of expandedCompanies) {
    await page.locator('#search').fill(company.code);
    await expect(page.locator('.company-card')).toHaveCount(1);
    await expect(page.locator('.company-card')).toContainText(company.name);
    await page.locator('[data-detail]').click();
    await expect(page.locator('#company-dialog')).toBeVisible();
    await expect(page.locator('#company-dialog h2')).toContainText(company.name);
    await page.locator('#company-dialog [data-close]').click();
  }
});
