import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '215A', name: 'タイミー' },
  { code: '4478', name: 'フリー' },
  { code: '4970', name: '東洋合成工業' },
  { code: '6890', name: 'フェローテック' },
  { code: '7287', name: '日本精機' },
];

test('keeps at least 140 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(5);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(140);
});

test('exposes every batch 09 company through search and detail', async ({ page }) => {
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
