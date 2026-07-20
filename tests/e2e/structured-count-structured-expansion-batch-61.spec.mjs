import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '2321', name: "ソフトフロントホールディングス" },
  { code: '2432', name: "ディー・エヌ・エー" },
  { code: '285A', name: "キオクシアホールディングス" },
  { code: '3360', name: "シップヘルスケアホールディングス" },
  { code: '3659', name: "ネクソン" },
  { code: '4021', name: "日産化学" },
  { code: '4373', name: "シンプレクス・ホールディングス" },
  { code: '5901', name: "東洋製罐グループホールディングス" },
  { code: '5929', name: "三和ホールディングス" },
  { code: '6305', name: "日立建機" },
];

test('keeps at least 261 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(10);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(10);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('298社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(261);
});

test('exposes every structured-expansion-batch-61 company through search and detail', async ({ page }) => {
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
