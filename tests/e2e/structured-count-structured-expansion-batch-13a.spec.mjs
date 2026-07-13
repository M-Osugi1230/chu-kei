import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '147A', name: "ソラコム" },
  { code: '290A', name: "Synspective" },
  { code: '2998', name: "クリアル" },
  { code: '3994', name: "マネーフォワード" },
  { code: '5038', name: "eWeLL" },
  { code: '6227', name: "AIメカテック" },
  { code: '6521', name: "オキサイド" },
  { code: '6627', name: "テラプローブ" },
  { code: '6777', name: "santec Holdings" },
  { code: '9414', name: "日本BS放送" },
];

test('keeps at least 180 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(10);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(10);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(180);
});

test('exposes every structured-expansion-batch-13a company through search and detail', async ({ page }) => {
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
