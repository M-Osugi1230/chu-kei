import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '3657', name: "ポールトゥウィンホールディングス" },
  { code: '3661', name: "エムアップホールディングス" },
  { code: '3962', name: "チェンジホールディングス" },
  { code: '4004', name: "レゾナック・ホールディングス" },
  { code: '4011', name: "ヘッドウォータース" },
];

test('keeps at least 271 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(5);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(5);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('298社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(271);
});

test('exposes every structured-expansion-batch-64 company through search and detail', async ({ page }) => {
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
