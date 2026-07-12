import { test, expect } from '@playwright/test';

test('keeps at least 130 companies available for structured comparison', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#stat-total')).toHaveText('570社');
  await expect(page.locator('#stat-confirmed')).toHaveText('200社');
  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));
  expect(structuredCount).toBeGreaterThanOrEqual(130);
});
