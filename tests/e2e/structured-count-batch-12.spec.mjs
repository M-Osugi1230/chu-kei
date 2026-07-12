import { test, expect } from '@playwright/test';

const expandedCompanies = [
  { code: '2702', name: '日本マクドナルドホールディングス' },
  { code: '4324', name: '電通グループ' },
  { code: '4369', name: 'トリケミカル研究所' },
  { code: '4375', name: 'セーフィー' },
  { code: '4593', name: 'ヘリオス' },
  { code: '6239', name: 'ナガオカ' },
  { code: '6291', name: '日本エアーテック' },
  { code: '6626', name: 'SEMITEC' },
  { code: '6637', name: '寺崎電気産業' },
  { code: '6677', name: 'エスケーエレクトロニクス' },
  { code: '6855', name: '日本電子材料' },
  { code: '7214', name: 'GMB' },
  { code: '7373', name: 'アイドマ・ホールディングス' },
  { code: '7746', name: '岡本硝子' },
  { code: '8029', name: 'ルックホールディングス' },
  { code: '8704', name: 'トレイダーズホールディングス' },
  { code: '9033', name: '広島電鉄' },
  { code: '9380', name: '東海運' },
  { code: '9708', name: '帝国ホテル' },
  { code: '9972', name: 'アルテック' },
];

test('keeps at least 170 companies available for structured comparison', async ({ page }) => {
  expect(expandedCompanies).toHaveLength(20);
  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(20);
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(170);
});

test('exposes every batch 12 company through search and detail', async ({ page }) => {
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
