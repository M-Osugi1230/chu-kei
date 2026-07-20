import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '1301', name: "極洋" },
  { code: '1332', name: "ニッスイ" },
  { code: '1375', name: "ユキグニファクトリー" },
  { code: '1376', name: "カネコ種苗" },
  { code: '1377', name: "サカタのタネ" },
  { code: '1417', name: "ミライト・ワン" },
  { code: '1419', name: "タマホーム" },
];

test('keeps at least 305 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(7);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(7);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('305社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(305);
});

test('exposes every structured-expansion-batch-70 company through search and detail', async ({ page }) => {
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
