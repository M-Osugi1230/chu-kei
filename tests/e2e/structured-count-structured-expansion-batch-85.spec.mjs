import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '1407', name: "ウエストホールディングス" },
  { code: '1813', name: "不動テトラ" },
  { code: '1848', name: "富士ピー・エス" },
  { code: '2124', name: "ジェイエイシーリクルートメント" },
  { code: '2138', name: "クルーズ" },
  { code: '2152', name: "幼児活動研究会" },
  { code: '2169', name: "ＣＤＳ" },
  { code: '2185', name: "シイエム・シイ" },
  { code: '2201', name: "森永製菓" },
  { code: '2215', name: "第一屋製パン" },
  { code: '2220', name: "亀田製菓" },
  { code: '2305', name: "スタジオアリス" },
  { code: '2337', name: "いちご" },
  { code: '2375', name: "ギグワークス" },
  { code: '2410', name: "キャリアデザインセンター" },
  { code: '2415', name: "ヒューマンホールディングス" },
  { code: '2480', name: "システム・ロケーション" },
  { code: '2484', name: "出前館" },
  { code: '2705', name: "大戸屋ホールディングス" },
  { code: '2752', name: "フジオフードグループ本社" },
  { code: '2776', name: "新都ホールディングス" },
  { code: '2904', name: "一正蒲鉾" },
  { code: '3001', name: "片倉工業" },
  { code: '3011', name: "バナーズ" },
  { code: '3054', name: "ハイパー" },
  { code: '3071', name: "ストリーム" },
  { code: '3150', name: "グリムス" },
  { code: '3169', name: "ミサワ" },
  { code: '3199', name: "綿半ホールディングス" },
  { code: '3222', name: "ユナイテッド・スーパーマーケット・ホールディングス" },
  { code: '3248', name: "アールエイジ" },
  { code: '3323', name: "レカム" },
  { code: '3445', name: "ＲＳ Ｔｅｃｈｎｏｌｏｇｉｅｓ" },
  { code: '3469', name: "デュアルタップ" },
  { code: '3539', name: "ＪＭホールディングス" },
  { code: '3660', name: "アイスタイル" },
  { code: '3665', name: "エニグモ" },
  { code: '3686', name: "ディー・エル・イー" },
  { code: '3771', name: "システムリサーチ" },
  { code: '3772', name: "ウェルス・マネジメント" },
  { code: '3817', name: "ＳＲＡホールディングス" },
  { code: '3853', name: "アステリア" },
  { code: '3939', name: "カナミックネットワーク" },
  { code: '3993', name: "ＰＫＳＨＡ　Ｔｅｃｈｎｏｌｏｇｙ" },
  { code: '4097', name: "高圧ガス工業" },
  { code: '4120', name: "スガイ化学工業" },
  { code: '4307', name: "野村総合研究所" },
  { code: '4361', name: "川口化学工業" },
  { code: '4536', name: "参天製薬" },
  { code: '4547', name: "キッセイ薬品工業" },
  { code: '4595', name: "ミズホメディー" },
  { code: '4641', name: "アルプス技研" },
  { code: '4716', name: "日本オラクル" },
  { code: '4825', name: "ウェザーニューズ" },
  { code: '5381', name: "マイポックス" },
  { code: '5445', name: "東京鐵鋼" },
  { code: '5449', name: "大阪製鐵" },
  { code: '5491', name: "日本金属" },
  { code: '5542', name: "新報国マテリアル" },
  { code: '5857', name: "ＡＲＥホールディングス" },
  { code: '5938', name: "ＬＩＸＩＬ" },
  { code: '6038', name: "イード" },
  { code: '6047', name: "Ｇｕｎｏｓｙ" },
  { code: '6157', name: "日進工具" },
  { code: '6254', name: "野村マイクロ・サイエンス" },
  { code: '6276', name: "シリウスビジョン" },
  { code: '6349', name: "小森コーポレーション" },
  { code: '6358', name: "酒井重工業" },
  { code: '6560', name: "エル・ティー・エス" },
  { code: '6615', name: "ユー・エム・シー・エレクトロニクス" },
  { code: '6616', name: "トレックス・セミコンダクター" },
  { code: '6619', name: "ダブル・スコープ" },
  { code: '6622', name: "ダイヘン" },
  { code: '6662', name: "ユビテック" },
  { code: '6740', name: "ジャパンディスプレイ" },
  { code: '6770', name: "アルプスアルパイン" },
  { code: '7012', name: "川崎重工業" },
  { code: '7102', name: "日本車輌製造" },
  { code: '7180', name: "九州フィナンシャルグループ" },
  { code: '7184', name: "富山第一銀行" },
  { code: '7198', name: "ＳＢＩアルヒ" },
  { code: '7600', name: "日本エム・ディ・エム" },
  { code: '7616', name: "コロワイド" },
  { code: '7730', name: "マニー" },
  { code: '7815', name: "東京ボード工業" },
  { code: '7851', name: "カワセコンピュータサプライ" },
  { code: '7906', name: "ヨネックス" },
  { code: '7915', name: "ＮＩＳＳＨＡ" },
  { code: '7946', name: "光陽社" },
  { code: '7956', name: "ピジョン" },
  { code: '8056', name: "ＢＩＰＲＯＧＹ" },
  { code: '8143', name: "ラピーヌ" },
  { code: '8227', name: "しまむら" },
  { code: '8341', name: "七十七銀行" },
  { code: '8624', name: "いちよし証券" },
  { code: '8789', name: "フィンテック グローバル" },
  { code: '8935', name: "ＦＪネクストホールディングス" },
  { code: '9069', name: "センコーグループホールディングス" },
  { code: '9087', name: "タカセ" },
  { code: '9143', name: "ＳＧホールディングス" },
  { code: '9206', name: "スターフライヤー" },
  { code: '9301', name: "三菱倉庫" },
];

test('keeps at least 2490 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(102);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(102);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('2500社');
  await expect(page.locator('#stat-confirmed')).toHaveText('2490社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(2490);
});

test('exposes every structured-expansion-batch-85 company through search and detail', async ({ page }) => {
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
