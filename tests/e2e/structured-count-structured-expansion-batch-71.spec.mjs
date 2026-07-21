import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '167A', name: "リョーサン菱洋ホールディングス" },
  { code: '2784', name: "アルフレッサ　ホールディングス" },
  { code: '2975', name: "スター・マイカ・ホールディングス" },
  { code: '3031', name: "ラクーンホールディングス" },
  { code: '3151', name: "バイタルケーエスケー・ホールディングス" },
  { code: '3232', name: "三重交通グループホールディングス" },
];

test('keeps at least 311 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(6);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(6);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('311社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(311);
});

test('exposes every structured-expansion-batch-71 company through search and detail', async ({ page }) => {
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
