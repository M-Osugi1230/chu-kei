import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '3905', name: "データセクション" },
  { code: '6069', name: "トレンダーズ" },
  { code: '6564', name: "ミダックホールディングス" },
];

test('keeps at least 2500 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(3);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(3);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('2500社');
  await expect(page.locator('#stat-confirmed')).toHaveText('2500社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(2500);
});

test('exposes every structured-expansion-batch-87 company through search and detail', async ({ page }) => {
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
