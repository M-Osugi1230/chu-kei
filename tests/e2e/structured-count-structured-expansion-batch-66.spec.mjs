import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '4014', name: "カラダノート" },
  { code: '6134', name: "ＦＵＪＩ" },
  { code: '6196', name: "ストライクグループ" },
  { code: '6302', name: "住友重機械工業" },
  { code: '6323', name: "ローツェ" },
  { code: '6523', name: "ＰＨＣホールディングス" },
  { code: '6544', name: "ジャパンエレベーターサービスホールディングス" },
  { code: '7085', name: "カーブスホールディングス" },
  { code: '7130', name: "ヤマエグループホールディングス" },
  { code: '7459', name: "メディパルホールディングス" },
];

test('keeps at least 286 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(10);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(10);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('298社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(286);
});

test('exposes every structured-expansion-batch-66 company through search and detail', async ({ page }) => {
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
