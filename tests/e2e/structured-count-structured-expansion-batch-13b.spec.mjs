import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '2160', name: "ジーエヌアイグループ" },
  { code: '4165', name: "プレイド" },
  { code: '4894', name: "クオリプス" },
  { code: '8473', name: "SBIホールディングス" },
  { code: '8772', name: "アサックス" },
  { code: '8871', name: "ゴールドクレスト" },
  { code: '9022', name: "東海旅客鉄道" },
  { code: '9475', name: "昭文社ホールディングス" },
  { code: '3491', name: "GA technologies" },
  { code: '9051', name: "センコン物流" },
];

test('keeps at least 190 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(10);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(10);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(190);
});

test('exposes every structured-expansion-batch-13b company through search and detail', async ({ page }) => {
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
