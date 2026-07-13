import { test, expect } from '@playwright/test';

const detailRequestPattern = /\/data\/frontend\/details-\d+\.json\.gz(?:$|\?)/;

async function searchCompany(page, code) {
  await page.locator('#search').fill(code);
  await expect(page.locator('.company-card')).toHaveCount(1);
}

test('loads only the compact index initially and caches a detail shard after opening a company', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));

  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  expect(requests.some(path => path.endsWith('/data/frontend/company-index.json.gz'))).toBeTruthy();
  expect(requests.filter(path => detailRequestPattern.test(path))).toHaveLength(0);

  await searchCompany(page, '5574');
  await page.locator('[data-detail]').click();
  await expect(page.locator('#company-dialog')).toBeVisible();
  await expect(page.locator('#company-dialog')).toContainText('売上目標');
  await expect(page.locator('#company-dialog a', { hasText: '公式資料を開く' })).toBeVisible();
  expect(requests.filter(path => detailRequestPattern.test(path))).toHaveLength(1);

  await page.locator('#company-dialog [data-close]').click();
  await page.locator('[data-detail]').click();
  await expect(page.locator('#company-dialog')).toContainText('売上目標');
  expect(requests.filter(path => detailRequestPattern.test(path))).toHaveLength(1);
});

test('loads only the selected companies detail shards for comparison', async ({ page }) => {
  const detailRequests = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (detailRequestPattern.test(pathname)) detailRequests.push(pathname);
  });

  await page.goto('/');
  await searchCompany(page, '5574');
  await page.locator('[data-compare]').click();
  await searchCompany(page, '9761');
  await page.locator('[data-compare]').click();
  await expect(page.locator('#compare-count')).toHaveText('2');

  await page.locator('#open-compare').click();
  await expect(page.locator('#compare-dialog')).toBeVisible();
  await expect(page.locator('#compare-dialog')).toContainText('ABEJA');
  await expect(page.locator('#compare-dialog')).toContainText('東海リース');
  await expect(page.locator('#compare-dialog')).toContainText('売上目標');
  expect(new Set(detailRequests).size).toBe(2);
});

test('shows a retry action when a detail shard fails and recovers without reloading the page', async ({ page }) => {
  let shouldFail = true;
  await page.route(detailRequestPattern, async route => {
    if (shouldFail) {
      shouldFail = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await searchCompany(page, '5574');
  await page.locator('[data-detail]').click();
  await expect(page.locator('#company-dialog')).toContainText('詳細データを読み込めませんでした');
  await expect(page.locator('[data-retry-detail]')).toBeVisible();

  await page.locator('[data-retry-detail]').click();
  await expect(page.locator('#company-dialog')).toContainText('売上目標');
  await expect(page.locator('#company-dialog a', { hasText: '公式資料を開く' })).toBeVisible();
});
