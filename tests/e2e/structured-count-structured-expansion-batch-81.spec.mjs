import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '1788', name: "三東工業社" },
  { code: '1793', name: "大本組" },
  { code: '1795', name: "マサル" },
  { code: '1798', name: "守谷商会" },
  { code: '1799', name: "第一建設工業" },
  { code: '1811', name: "錢高組" },
  { code: '1826', name: "佐田建設" },
  { code: '1828', name: "田辺工業" },
  { code: '274A', name: "ガーデン" },
  { code: '2762', name: "ＳＡＮＫＯ ＭＡＲＫＥＴＩＮＧ ＦＯＯＤＳ" },
  { code: '2764', name: "ひらまつ" },
  { code: '2769', name: "ヴィレッジヴァンガードコーポレーション" },
  { code: '2782', name: "セリア" },
  { code: '2789', name: "カルラ" },
  { code: '2790', name: "ナフコ" },
  { code: '2798', name: "ワイズテーブルコーポレーション" },
  { code: '2805', name: "ヱスビー食品" },
  { code: '2806', name: "ユタカフーズ" },
  { code: '2813', name: "和弘食品" },
  { code: '2814', name: "佐藤食品工業" },
  { code: '2816', name: "ダイショー" },
  { code: '2820', name: "やまみ" },
  { code: '2831', name: "はごろもフーズ" },
  { code: '2872', name: "セイヒョー" },
  { code: '2876', name: "デルソーレ" },
  { code: '2877', name: "日東ベスト" },
  { code: '3299', name: "ムゲンエステート" },
  { code: '3452', name: "ビーロット" },
  { code: '3454', name: "ファーストブラザーズ" },
  { code: '3461', name: "パルマ" },
  { code: '3467', name: "アグレ都市デザイン" },
  { code: '3607', name: "クラウディアホールディングス" },
  { code: '3611', name: "マツオカコーポレーション" },
  { code: '365A', name: "伊澤タオル" },
  { code: '5356', name: "美濃窯業" },
  { code: '5363', name: "東京窯業" },
  { code: '5367', name: "ニッカトー" },
  { code: '5368', name: "日本インシュレーション" },
  { code: '5380', name: "新東" },
  { code: '5388', name: "クニミネ工業" },
  { code: '5391', name: "エーアンドエーマテリアル" },
  { code: '5393', name: "ニチアス" },
];

test('keeps at least 1500 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(42);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(42);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('1900社');
  await expect(page.locator('#stat-confirmed')).toHaveText('1500社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(1500);
});

test('exposes every structured-expansion-batch-81 company through search and detail', async ({ page }) => {
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
