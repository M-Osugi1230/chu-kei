import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '5574', name: "ABEJA" },
  { code: '6146', name: "ディスコ" },
  { code: '6264', name: "マルマエ" },
  { code: '6273', name: "SMC" },
  { code: '6338', name: "タカトリ" },
  { code: '6613', name: "QDレーザ" },
  { code: '6723', name: "ルネサスエレクトロニクス" },
  { code: '7741', name: "HOYA" },
  { code: '8198', name: "マックスバリュ東海" },
  { code: '9761', name: "東海リース" },
];

test('keeps at least 200 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(10);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(10);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(200);
});

test('exposes every structured-expansion-batch-13c company through search and detail', async ({ page }) => {
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
