import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '2157', name: "コシダカホールディングス" },
  { code: '2326', name: "デジタルアーツ" },
  { code: '2433', name: "博報堂ＤＹホールディングス" },
  { code: '3099', name: "三越伊勢丹ホールディングス" },
  { code: '3107', name: "ダイワボウホールディングス" },
  { code: '3132', name: "マクニカホールディングス" },
  { code: '3197', name: "すかいらーくホールディングス" },
  { code: '3291', name: "飯田グループホールディングス" },
];

test('keeps at least 251 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(8);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(8);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('298社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(251);
});

test('exposes every structured-expansion-batch-60 company through search and detail', async ({ page }) => {
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
