import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '3300', name: "アンビション　ＤＸ　ホールディングス" },
  { code: '3632', name: "グリーホールディングス" },
  { code: '7649', name: "スギホールディングス" },
  { code: '8252', name: "丸井グループ" },
  { code: '8876', name: "リログループ" },
  { code: '9413', name: "テレビ東京ホールディングス" },
  { code: '9627', name: "アインホールディングス" },
  { code: '9699', name: "ニシオホールディングス" },
  { code: '9744', name: "メイテックグループホールディングス" },
  { code: '9766', name: "コナミグループ" },
  { code: '9962', name: "ミスミグループ本社" },
];

test('keeps at least 297 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(11);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(11);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('298社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(297);
});

test('exposes every structured-expansion-batch-68 company through search and detail', async ({ page }) => {
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
