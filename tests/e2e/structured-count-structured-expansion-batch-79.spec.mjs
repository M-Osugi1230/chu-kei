import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '1724', name: "シンクレイヤ" },
  { code: '1758', name: "太洋基礎工業" },
  { code: '1764', name: "工藤建設" },
  { code: '1770', name: "藤田エンジニアリング" },
  { code: '2293', name: "滝沢ハム" },
  { code: '2573', name: "北海道コカ・コーラボトリング" },
  { code: '2597', name: "ユニカフェ" },
  { code: '2612', name: "かどや製油" },
  { code: '2747', name: "北雄ラッキー" },
  { code: '2788', name: "アップルインターナショナル" },
  { code: '2795', name: "日本プリメックス" },
  { code: '3004', name: "神栄" },
  { code: '3238', name: "セントラル総合開発" },
  { code: '3246', name: "コーセーアールイー" },
  { code: '3277', name: "サンセイランディック" },
  { code: '3444', name: "菊池製作所" },
  { code: '3446', name: "ジェイテックコーポレーション" },
  { code: '3447', name: "信和" },
  { code: '3449', name: "テクノフレックス" },
  { code: '3583', name: "オーベクス" },
  { code: '3597', name: "自重堂" },
  { code: '3598', name: "山喜" },
  { code: '3600', name: "フジックス" },
  { code: '3955', name: "イムラ" },
  { code: '3958', name: "笹徳印刷" },
  { code: '4224', name: "ロンシール工業" },
  { code: '5290', name: "ベルテクスコーポレーション" },
  { code: '5304', name: "ＳＥＣカーボン" },
  { code: '5331', name: "ノリタケ" },
  { code: '5337', name: "ダントーホールディングス" },
  { code: '5341', name: "ＡＳＡＨＩ ＥＩＴＯホールディングス" },
  { code: '5344', name: "ＭＡＲＵＷＡ" },
  { code: '5351', name: "品川リフラ" },
  { code: '5355', name: "日本坩堝" },
  { code: '5357', name: "ヨータイ" },
  { code: '5658', name: "日亜鋼業" },
  { code: '5660', name: "神鋼鋼線工業" },
  { code: '5695', name: "パウダーテック" },
  { code: '5697', name: "サンユウ" },
  { code: '5699', name: "イボキン" },
  { code: '5819', name: "カナレ電気" },
  { code: '5900', name: "ダイケン" },
  { code: '7215', name: "ファルテック" },
  { code: '7217', name: "テイン" },
  { code: '7218', name: "田中精密工業" },
  { code: '7219', name: "エッチ・ケー・エス" },
  { code: '7228', name: "デイトナ" },
  { code: '7235', name: "東京ラヂエーター製造" },
  { code: '7305', name: "新家工業" },
  { code: '7819', name: "粧美堂" },
  { code: '7822', name: "永大産業" },
  { code: '7827', name: "オービス" },
  { code: '7831', name: "ウイルコホールディングス" },
  { code: '7914', name: "共同印刷" },
  { code: '7921', name: "ＴＡＫＡＲＡ ＆ ＣＯＭＰＡＮＹ" },
  { code: '7944', name: "ローランド" },
  { code: '8011', name: "三陽商会" },
  { code: '8737', name: "あかつき本社" },
  { code: '8742', name: "小林洋行" },
  { code: '8747', name: "豊トラスティ証券" },
  { code: '9057', name: "遠州トラック" },
  { code: '9060', name: "日本ロジテム" },
  { code: '9063', name: "岡山県貨物運送" },
  { code: '9074', name: "日本石油輸送" },
  { code: '9353', name: "櫻島埠頭" },
  { code: '9355', name: "リンコーコーポレーション" },
  { code: '9361', name: "伏木海陸運送" },
  { code: '9362', name: "兵機海運" },
  { code: '9363', name: "大運" },
  { code: '9365', name: "トレーディア" },
  { code: '9511', name: "沖縄電力" },
  { code: '9513', name: "電源開発" },
  { code: '9519', name: "レノバ" },
  { code: '9531', name: "東京瓦斯" },
  { code: '9532', name: "大阪瓦斯" },
];

test('keeps at least 1225 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(75);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(75);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1500社');
  await expect(page.locator('#stat-confirmed')).toHaveText('1225社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(1225);
});

test('exposes every structured-expansion-batch-79 company through search and detail', async ({ page }) => {
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
