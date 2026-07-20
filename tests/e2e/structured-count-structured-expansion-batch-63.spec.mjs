import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '3070', name: "ジェリービーンズグループ" },
  { code: '3371', name: "ソフトクリエイトホールディングス" },
  { code: '3391', name: "ツルハホールディングス" },
  { code: '3397', name: "トリドールホールディングス" },
  { code: '4013', name: "勤次郎" },
];

test('keeps at least 266 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(5);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(5);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('298社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(266);
});

test('exposes every structured-expansion-batch-63 company through search and detail', async ({ page }) => {
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
