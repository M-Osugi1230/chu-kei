import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '2267', name: 'ヤクルト本社' },
  { code: '2780', name: 'コメ兵ホールディングス' },
  { code: '5802', name: '住友電気工業' },
  { code: '6762', name: 'TDK' },
  { code: '8233', name: '高島屋' },
];

test('keeps at least 135 companies available for structured comparison', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(135);
});

test('exposes every batch 08 company through search and detail', async ({ page }) => {
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
