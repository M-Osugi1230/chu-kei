import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '4076', name: "シイエヌエス" },
  { code: '4997', name: "日本農薬" },
  { code: '7039', name: "ブリッジインターナショナルグループ" },
  { code: '9832', name: "オートバックスセブン" },
];

test('keeps at least 3000 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(4);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(4);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('3000社');
  await expect(page.locator('#stat-confirmed')).toHaveText('3000社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(3000);
});

test('exposes every structured-expansion-batch-91 company through search and detail', async ({ page }) => {
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
