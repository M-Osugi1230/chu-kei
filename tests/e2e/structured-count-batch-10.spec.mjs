import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '2587', name: 'サントリービバレッジ&フード' },
  { code: '2914', name: '日本たばこ産業' },
  { code: '3092', name: 'ZOZO' },
  { code: '6963', name: 'ローム' },
  { code: '7685', name: 'BuySell Technologies' },
];

test('keeps at least 145 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(5);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(145);
});

test('exposes every batch 10 company through search and detail', async ({ page }) => {
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
