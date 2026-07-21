import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '1380', name: "秋川牧園" },
  { code: '1381', name: "アクシーズ" },
  { code: '1382', name: "ホーブ" },
  { code: '1383', name: "ベルグアース" },
  { code: '1384', name: "ホクリヨウ" },
  { code: '168A', name: "イタミアート" },
  { code: '3103', name: "ユニチカ" },
  { code: '3111', name: "オーミケンシ" },
  { code: '3123', name: "サイボー" },
  { code: '3202', name: "ダイトウボウ" },
  { code: '3204', name: "トーア紡コーポレーション" },
  { code: '3205', name: "ダイドーリミテッド" },
  { code: '325A', name: "ＴＥＮＴＩＡＬ" },
  { code: '3409', name: "北紡" },
  { code: '350A', name: "デジタルグリッド" },
  { code: '3512', name: "日本フエルト" },
  { code: '3513', name: "イチカワ" },
  { code: '3524', name: "日東製網" },
  { code: '3891', name: "ニッポン高度紙工業" },
  { code: '3892', name: "岡山製紙" },
  { code: '3895', name: "ハビックス" },
  { code: '3896', name: "阿波製紙" },
  { code: '3943', name: "大石産業" },
  { code: '3944', name: "古林紙工" },
  { code: '3945', name: "スーパーバッグ" },
  { code: '3948', name: "光ビジネスフォーム" },
  { code: '4026', name: "神島化学工業" },
  { code: '442A', name: "クラシコ" },
  { code: '5010', name: "日本精蝋" },
  { code: '5013', name: "ユシロ" },
  { code: '5015', name: "ビーピー・カストロール" },
  { code: '5018', name: "ＭＯＲＥＳＣＯ" },
  { code: '5103', name: "昭和ホールディングス" },
  { code: '5161', name: "西川ゴム工業" },
  { code: '5162', name: "朝日ラバー" },
  { code: '5184', name: "ニチリン" },
  { code: '5189', name: "櫻護謨" },
  { code: '5194', name: "相模ゴム工業" },
  { code: '5204', name: "石塚硝子" },
  { code: '5218', name: "オハラ" },
  { code: '5237', name: "ノザワ" },
  { code: '5268', name: "旭コンクリート工業" },
  { code: '5271', name: "トーヨーアサノ" },
  { code: '5273', name: "三谷セキサン" },
  { code: '5279', name: "日本興業" },
  { code: '5284', name: "ヤマウホールディングス" },
  { code: '5285', name: "ヤマックス" },
  { code: '5962', name: "浅香工業" },
  { code: '7792', name: "コラントッテ" },
  { code: '7793', name: "イメージ・マジック" },
  { code: '7795', name: "ＫＹＯＲＩＴＳＵ" },
  { code: '7800', name: "アミファ" },
  { code: '7803', name: "ブシロード" },
  { code: '7805', name: "プリントネット" },
  { code: '7806', name: "ＭＴＧ" },
  { code: '7807', name: "幸和製作所" },
  { code: '7808', name: "シー・エス・ランバー" },
  { code: '7809', name: "壽屋" },
  { code: '7811', name: "中本パックス" },
  { code: '7812', name: "クレステック" },
  { code: '7813', name: "プラッツ" },
  { code: '7823', name: "アートネイチャー" },
  { code: '7937', name: "ツツミ" },
  { code: '7987', name: "ナカバヤシ" },
  { code: '9506', name: "東北電力" },
  { code: '9507', name: "四国電力" },
  { code: '9508', name: "九州電力" },
  { code: '9509', name: "北海道電力" },
  { code: '9514', name: "エフオン" },
  { code: '9537', name: "北陸瓦斯" },
  { code: '9539', name: "京葉瓦斯" },
];

test('keeps at least 984 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(71);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(71);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1200社');
  await expect(page.locator('#stat-confirmed')).toHaveText('984社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(984);
});

test('exposes every structured-expansion-batch-76 company through search and detail', async ({ page }) => {
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
