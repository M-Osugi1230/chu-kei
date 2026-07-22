import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '1951', name: "エクシオグループ" },
  { code: '1963', name: "日揮ホールディングス" },
  { code: '2579', name: "コカ・コーラ ボトラーズジャパンホールディングス" },
  { code: '2590', name: "ダイドーグループホールディングス" },
  { code: '2884', name: "ヨシムラ・フード・ホールディングス" },
  { code: '3387', name: "クリエイト・レストランツ・ホールディングス" },
  { code: '3395', name: "サンマルクホールディングス" },
  { code: '339A', name: "プログレス・テクノロジーズ グループ" },
  { code: '3625', name: "テックファームホールディングス" },
  { code: '3777', name: "環境フレンドリーホールディングス" },
  { code: '3837', name: "アドソル日進" },
  { code: '3854', name: "アイル" },
  { code: '3903', name: "ｇｕｍｉ" },
  { code: '3916', name: "デジタル・インフォメーション・テクノロジー" },
  { code: '3963', name: "シンクロ・フード" },
  { code: '3968', name: "セグエグループ" },
  { code: '3992', name: "ニーズウェル" },
  { code: '4051', name: "ＧＭＯフィナンシャルゲート" },
  { code: '415A', name: "ＧＭＯ ＴＥＣＨホールディングス" },
  { code: '4848', name: "フルキャストホールディングス" },
  { code: '6183', name: "ベルシステム２４ホールディングス" },
  { code: '6282', name: "オイレス工業" },
  { code: '6287', name: "サトー" },
  { code: '6289', name: "技研製作所" },
  { code: '6294', name: "オカダアイヨン" },
  { code: '6306', name: "日工" },
  { code: '6309', name: "巴工業" },
  { code: '6315', name: "ＴＯＷＡ" },
  { code: '6328', name: "荏原実業" },
  { code: '6331', name: "三菱化工機" },
  { code: '6333', name: "ＴＥＩＫＯＫＵ" },
  { code: '6340', name: "澁谷工業" },
  { code: '6361', name: "荏原製作所" },
  { code: '6706', name: "電気興業" },
  { code: '6724', name: "セイコーエプソン" },
  { code: '6727', name: "ワコム" },
  { code: '6737', name: "ＥＩＺＯ" },
  { code: '6741', name: "日本信号" },
  { code: '6742', name: "京三製作所" },
  { code: '6745', name: "ホーチキ" },
  { code: '6750', name: "エレコム" },
  { code: '6754', name: "アンリツ" },
  { code: '6763', name: "帝国通信工業" },
  { code: '7508', name: "Ｇ‐７ホールディングス" },
  { code: '8354', name: "ふくおかフィナンシャルグループ" },
  { code: '8377', name: "ほくほくフィナンシャルグループ" },
  { code: '8881', name: "日神グループホールディングス" },
  { code: '8897', name: "ＭＩＲＡＲＴＨホールディングス" },
  { code: '9090', name: "ＡＺ－ＣＯＭ丸和ホールディングス" },
];

test('keeps at least 1549 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(49);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(49);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('2500社');
  await expect(page.locator('#stat-confirmed')).toHaveText('1549社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(1549);
});

test('exposes every structured-expansion-batch-82 company through search and detail', async ({ page }) => {
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
