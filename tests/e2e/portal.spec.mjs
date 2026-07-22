import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const milestone = JSON.parse(
  fs.readFileSync(new URL('../../operations/quality/coverage-milestone-v1.json', import.meta.url), 'utf8'),
);
const productionReadiness = JSON.parse(
  fs.readFileSync(new URL('../../operations/production-quality/production-readiness-v1.json', import.meta.url), 'utf8'),
);

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

async function expectQueueSummary(page) {
  const candidateCount = await page.locator('#queue-body tr[data-company-code]').count();
  await expect(page.locator('#queue-summary')).toHaveText(`${candidateCount}社を表示`);
  if (candidateCount === 0) {
    await expect(page.locator('#queue-body .empty-row')).toHaveCount(1);
  } else {
    await expect(page.locator('#queue-body .empty-row')).toHaveCount(0);
  }
  return candidateCount;
}

test.describe('Chu-kei portal', () => {
  test('loads the milestone company set and supports search, strategy, detail and comparison', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.goto('/');
    await expect(page).toHaveTitle(/Chu-kei/);
    await expect(page.locator('#stat-total')).toHaveText(`${milestone.companyTotal}社`);
    await expect(page.locator('#stat-confirmed')).toHaveText(`${milestone.minimumSourceConfirmed}社`);
    await expect(page.locator('#stat-structured')).toHaveText(`${milestone.minimumStructured}社`);
    await expect(page.locator('#stat-progress')).toContainText(`${milestone.progressRows}件`);
    await expect(page.locator('.company-card')).toHaveCount(50);

    await page.locator('#search').fill('三菱重工業');
    await expect(page.locator('.company-card')).toHaveCount(1);
    await expect(page.locator('.company-card')).toContainText('三菱重工業');

    await page.locator('#search').fill('７０１１');
    await expect(page.locator('.company-card')).toHaveCount(1);
    await expect(page.locator('.company-card')).toContainText('三菱重工業');

    await page.locator('#search').fill('7011 Prime');
    await expect(page.locator('.company-card')).toHaveCount(1);
    await expect(page.locator('.company-card')).toContainText('三菱重工業');

    await page.getByRole('button', { name: '条件をリセット' }).click();
    await expect(page.locator('.company-card')).toHaveCount(50);

    const maCard = page.locator('[data-strategy="ma"]');
    const maCountText = await maCard.locator('span').textContent();
    const maCount = Number(maCountText.replace(/[^0-9]/g, ''));
    expect(maCount).toBeGreaterThanOrEqual(55);
    await maCard.click();
    await expect(maCard).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#result-summary')).toContainText(`${maCount}社が該当`);
    await page.locator('#clear-strategy').click();
    await expect(page.locator('.company-card')).toHaveCount(50);

    await page.locator('[data-detail]').first().click();
    await expect(page.locator('#company-dialog')).toBeVisible();
    await expect(page.locator('#company-dialog h2')).not.toBeEmpty();
    await page.locator('#company-dialog [data-close]').click();

    const compareButtons = page.locator('[data-compare]');
    await compareButtons.nth(0).click();
    await compareButtons.nth(1).click();
    await expect(page.locator('#compare-count')).toHaveText('2');
    await page.locator('#open-compare').click();
    await expect(page.locator('#compare-dialog')).toBeVisible();
    await expect(page.locator('#compare-dialog thead th')).toHaveCount(3);
    await expect(page.locator('#compare-dialog')).toContainText('進捗データ');
    await page.locator('#compare-dialog [data-close]').click();

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
    await expectNoErrors(errors);
  });

  test('shows target, actual, progress rate, years and evidence without hiding negative values', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.goto('/?q=175A#company=175A');
    await expect(page.locator('#company-dialog')).toBeVisible();
    await expect(page.locator('#company-dialog h2')).not.toBeEmpty();
    await expect(page.locator('.progress-card')).toHaveCount(3);
    await expect(page.locator('.progress-section')).toContainText('3目標・実績3件');
    await expect(page.locator('.progress-section')).toContainText('実績接続済み');
    await expect(page.locator('.progress-section')).toContainText('FY2030');
    await expect(page.locator('.progress-section')).toContainText('FY2025');
    await expect(page.locator('.progress-section')).toContainText('単純進捗率 -291.7%');
    await expect(page.locator('.progress-section')).toContainText('目標の根拠');
    await expect(page.locator('.progress-section')).toContainText('実績の根拠');
    await expect(page.locator('.progress-note')).toContainText('達成確率');

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
    await expectNoErrors(errors);
  });

  test('restores a shared workspace and persists saved companies locally', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.goto('/?q=7011&market=Prime&sort=quality&compare=7011,6501#company=7011');

    await expect(page.locator('#search')).toHaveValue('7011');
    await expect(page.locator('#market')).toHaveValue('Prime');
    await expect(page.locator('#sort')).toHaveValue('quality');
    await expect(page.locator('#compare-count')).toHaveText('2');
    await expect(page.locator('#company-dialog')).toBeVisible();
    await expect(page.locator('#company-dialog h2')).toContainText('三菱重工業');
    await page.locator('#company-dialog [data-close]').click();
    await expect(page).not.toHaveURL(/#company=/);

    const saveButton = page.locator('[data-save="7011"]');
    await saveButton.click();
    await expect(page.locator('#saved-summary')).toHaveText('保存 1社');
    await expect(saveButton).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(page.locator('#saved-summary')).toHaveText('保存 1社');
    await expect(page.locator('[data-save="7011"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#compare-count')).toHaveText('2');

    await page.locator('#saved-summary').click();
    await expect(page.locator('#saved-only')).toBeChecked();
    await expect(page.locator('#result-summary')).toContainText('保存企業のみ');
    await expect(page).toHaveURL(/saved=1/);
    await expect(page.locator('[data-clear-filter="saved"]')).toBeVisible();

    await page.locator('#share-workspace').click();
    await expect(page.locator('#toast')).toContainText('調査リンクをコピーしました');

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
    await expectNoErrors(errors);
  });

  test('quality dashboard exposes an evidence-driven review queue or a verified completed state', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.goto('/quality.html');
    await expect(page).toHaveTitle(/品質ダッシュボード/);
    await expect(page.locator('.quality-stat')).toHaveCount(8);
    await expect(page.locator('#queue-summary')).toBeVisible();
    const queueCount = await expectQueueSummary(page);

    await page.locator('#queue-priority').selectOption('A');
    const priorityACount = await expectQueueSummary(page);

    await page.locator('#queue-priority').selectOption('B');
    const priorityBCount = await expectQueueSummary(page);
    expect(priorityACount + priorityBCount).toBe(queueCount);
    if (queueCount > 0) expect(priorityACount).toBeGreaterThan(0);

    await page.locator('#queue-priority').selectOption('');
    if (queueCount > 0) {
      const firstCodeText = await page.locator('#queue-body tr[data-company-code]').first().locator('th small').textContent();
      const firstCode = firstCodeText.split('・')[0];
      await page.locator('#queue-search').fill(firstCode);
      await expect(page.locator('#queue-body tr[data-company-code]')).toHaveCount(1);
      await expect(page.locator('#queue-body')).toContainText(firstCode);
    } else {
      const productionCount = productionReadiness.currentProduction;
      await expect(page.locator('#queue-body .empty-row')).toContainText('条件に一致する企業がありません。');
      await expect(page.locator('#quality-summary')).toContainText(`本番品質${productionCount}社`);
      const productionAuditRow = page.locator('#audit-body tr').filter({ has: page.getByRole('rowheader', { name: '本番', exact: true }) });
      await expect(productionAuditRow).toContainText(`${productionCount} / ${productionCount}`);
    }

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
    await expectNoErrors(errors);
  });
});
