import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '4204', name: "積水化学工業" },
  { code: '3231', name: "野村不動産ホールディングス" },
  { code: '4544', name: "Ｈ．Ｕ．グループホールディングス" },
];

test('keeps at least 214 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(3);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(3);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('298社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(214);
});

test('exposes every structured-expansion-batch-17 company through search and detail', async ({ page }) => {
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
