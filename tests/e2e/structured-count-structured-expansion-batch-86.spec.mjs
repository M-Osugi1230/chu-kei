import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '2424', name: "ブラス" },
  { code: '4480', name: "メドレー" },
  { code: '543A', name: "ＡＲＣＨＩＯＮ" },
  { code: '544A', name: "ＧＭＳグループ" },
  { code: '547A', name: "ムニノバホールディングス" },
  { code: '575A', name: "前澤ホールディングス" },
  { code: '6194', name: "アトラエ" },
];

test('keeps at least 2497 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(7);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(7);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('2500社');
  await expect(page.locator('#stat-confirmed')).toHaveText('2497社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(2497);
});

test('exposes every structured-expansion-batch-86 company through search and detail', async ({ page }) => {
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
