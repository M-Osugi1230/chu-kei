import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '4443', name: 'Sansan' },
  { code: '4475', name: 'HENNGE' },
  { code: '5253', name: 'カバー' },
  { code: '7826', name: 'フルヤ金属' },
  { code: '9348', name: 'ispace' },
];

test('keeps at least 150 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(5);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(5);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(150);
});

test('exposes every batch 11 company through search and detail', async ({ page }) => {
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
