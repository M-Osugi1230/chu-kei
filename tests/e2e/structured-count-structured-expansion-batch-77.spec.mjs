import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '190A', name: "Ｃｈｏｒｄｉａ Ｔｈｅｒａｐｅｕｔｉｃｓ" },
  { code: '2130', name: "メンバーズ" },
  { code: '2164', name: "地域新聞社" },
  { code: '3563', name: "ＦＯＯＤ　＆　ＬＩＦＥ　ＣＯＭＰＡＮＩＥＳ" },
  { code: '3697', name: "ＳＨＩＦＴ" },
  { code: '3844', name: "コムチュア" },
  { code: '3954', name: "昭和パックス" },
  { code: '4008', name: "住友精化" },
  { code: '4071', name: "プラスアルファ・コンサルティング" },
  { code: '4094', name: "日本化学産業" },
  { code: '4563', name: "アンジェス" },
  { code: '542A', name: "ビタブリッドジャパン" },
  { code: '5698', name: "エンビプロ・ホールディングス" },
  { code: '6178', name: "日本郵政" },
  { code: '7794', name: "イーディーピー" },
  { code: '8349', name: "東北銀行" },
  { code: '8365', name: "富山銀行" },
  { code: '8700', name: "丸八証券" },
  { code: '9201', name: "日本航空" },
  { code: '9678', name: "カナモト" },
];

test('keeps at least 1004 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(20);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(20);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('1004社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(1004);
});

test('exposes every structured-expansion-batch-77 company through search and detail', async ({ page }) => {
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
