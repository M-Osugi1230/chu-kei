import { test, expect } from '@playwright/test';

function captureErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

async function expectNoErrors(errors) {
  expect(errors.consoleErrors, `console errors: ${errors.consoleErrors.join(' | ')}`).toEqual([]);
  expect(errors.pageErrors, `page errors: ${errors.pageErrors.join(' | ')}`).toEqual([]);
}

test.describe('Saved research shelf', () => {
  test('stays hidden without saved companies and appears after save', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.goto('/?q=7011');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('#saved-research-shelf')).toBeHidden();
    await page.locator('[data-save="7011"]').click();
    await expect(page.locator('#saved-research-shelf')).toBeVisible();
    await expect(page.locator('#saved-shelf-summary')).toContainText('保存 1社');
    await expect(page.locator('.saved-shelf-card')).toHaveCount(1);
    await expect(page.locator('.saved-shelf-card')).toContainText('三菱重工業');
    await expect(page.locator('.saved-shelf-card')).toContainText('確認済み');
    await expect(page.locator('#compare-saved')).toBeDisabled();

    await page.reload();
    await expect(page.locator('#saved-research-shelf')).toBeVisible();
    await expect(page.locator('.saved-shelf-card')).toContainText('三菱重工業');

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
    await expectNoErrors(errors);
  });

  test('shows local update status and marks company seen when research resumes', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('chukei.savedCompanies.v1', JSON.stringify(['7011']));
      localStorage.setItem('chukei.savedResearch.v2', JSON.stringify({
        version: 2,
        companies: {
          '7011': { savedAt: '2026-06-01T00:00:00.000Z', lastSeenVerifiedDate: '2026-06-01' },
        },
      }));
    });
    await page.goto('/');
    await expect(page.locator('#saved-shelf-summary')).toContainText('更新あり 1社');
    await expect(page.locator('.saved-shelf-card')).toContainText('更新あり');
    await expect(page.locator('#mark-saved-seen')).toBeVisible();

    await page.locator('[data-shelf-detail="7011"]').click();
    await expect(page).toHaveURL(/#company=7011/);
    await expect(page.locator('#company-dialog')).toBeVisible();
    await page.locator('#company-dialog [data-close]').click();
    const seenState = await page.evaluate(() => localStorage.getItem('chukei.savedResearch.v2'));
    await page.removeInitScript?.();
    await page.goto('/');
    await page.evaluate(value => localStorage.setItem('chukei.savedResearch.v2', value), seenState);
    await page.reload();
    await expect(page.locator('#saved-shelf-summary')).toContainText('更新あり 0社');
    await expect(page.locator('.saved-shelf-card')).toContainText('確認済み');

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
    await expectNoErrors(errors);
  });

  test('resumes saved-only view and compares up to four saved companies', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('chukei.savedCompanies.v1', JSON.stringify(['7011', '6501', '9432', '2282', '4755']));
    });
    await page.goto('/');
    await expect(page.locator('.saved-shelf-card')).toHaveCount(5);
    await expect(page.locator('#compare-saved')).toBeEnabled();

    await page.locator('#compare-saved').click();
    await expect(page).toHaveURL(/compare=/);
    await expect(page.locator('#compare-count')).toHaveText('4');
    await page.locator('#open-compare').click();
    await expect(page.locator('#compare-dialog')).toBeVisible();
    await expect(page.locator('#compare-dialog thead th')).toHaveCount(5);
    await page.locator('#compare-dialog [data-close]').click();

    await page.locator('#show-saved-results').click();
    await expect(page).toHaveURL(/saved=1/);
    await expect(page.locator('#saved-only')).toBeChecked();
    await expect(page.locator('#result-summary')).toContainText('5社が該当');

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
    await expectNoErrors(errors);
  });
});
