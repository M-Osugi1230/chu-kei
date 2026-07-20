import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('[data-workspace-preset]')).toHaveCount(4);
});

test('applies the trusted production-data preset', async ({ page }) => {
  const preset = page.locator('[data-workspace-preset="quality"]');
  await expect(preset).toBeEnabled();
  await preset.click();

  await expect(page.locator('#stage')).toHaveValue('core');
  await expect(page.locator('#sort')).toHaveValue('quality');
  await expect(page.locator('#active-filters')).toContainText('品質: 本番');
  await expect(page.locator('#active-filters')).toContainText('並び: 品質の高い順');
  await expect(page.locator('#preset-status')).toContainText('本番データに絞り');
});

test('applies the progress-connected preset without hiding beta records', async ({ page }) => {
  const preset = page.locator('[data-workspace-preset="progress"]');
  await preset.click();

  await expect(page.locator('#stage')).toHaveValue('');
  await expect(page.locator('#sort')).toHaveValue('verified');
  await expect(page.locator('.strategy-card[data-strategy="progress"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#active-filters')).toContainText('戦略: 進捗接続済み');
  await expect(page.locator('#preset-status')).toContainText('中計目標と実績を接続済み');
});
