import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const qualityRebase = JSON.parse(
  fs.readFileSync(new URL('../../site/data/quality-rebase-v1.json', import.meta.url), 'utf8'),
);

const qualityStats = [
  ['掲載企業', `${qualityRebase.counts.companies}社`],
  ['深掘り確認済み', `${qualityRebase.counts.deepVerified}社`],
  ['再監査対象', `${qualityRebase.counts.reAuditPool}社`],
  ['テンプレート型', `${qualityRebase.counts.templateReviewRequired}社`],
  ['決算短信の再探索', `${qualityRebase.counts.strictEarningsReleaseReSearch}社`],
  ['進捗データ', `${qualityRebase.counts.progressCompanies}社 / ${qualityRebase.counts.progressRecords}件`],
  ['Phase 1', `${qualityRebase.counts.phase1Selected}社`],
  ['Phase 2追加キュー', `${qualityRebase.counts.phase2AdditionalQueued}社`],
  ['証跡候補', `${qualityRebase.counts.evidenceCandidates}社`],
  ['既知404', `${qualityRebase.counts.knownBrokenLinks}件`],
];

const coverageOnly = qualityRebase.counts.companies
  - qualityRebase.counts.deepVerified
  - qualityRebase.counts.deepReviewInProgress
  - qualityRebase.counts.reAuditPool
  - qualityRebase.counts.templateReviewRequired;
const qualityAuditRows = [
  ['深掘り確認済み', qualityRebase.counts.deepVerified],
  ['深掘りレビュー中', qualityRebase.counts.deepReviewInProgress],
  ['再監査対象', qualityRebase.counts.reAuditPool],
  ['資料確認済み・深掘り前', qualityRebase.counts.templateReviewRequired],
  ['カバレッジのみ', coverageOnly],
];

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

async function expectAccessible(page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
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

async function expectQualitySummary(page) {
  await expect(page.locator('.quality-stat')).toHaveCount(qualityStats.length);
  for (const [label, value] of qualityStats) {
    const stat = page.locator('#quality-summary').getByText(label, { exact: true }).locator('..');
    await expect(stat).toContainText(value);
  }
}

async function expectQualityAudit(page) {
  expect(coverageOnly).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#audit-body tr')).toHaveCount(qualityAuditRows.length);
  for (const [label, companyCount] of qualityAuditRows) {
    const row = page.locator('#audit-body tr').filter({
      has: page.getByRole('rowheader', { name: label, exact: true }),
    });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').first()).toHaveText(String(companyCount));
    await expect(row.locator('.ratio')).toHaveCount(5);
    expect(await row.locator('.ratio small').allTextContents()).toEqual(
      Array(5).fill(` / ${companyCount}`),
    );
  }
}

test.describe('Accessibility and performance budgets', () => {
  test('portal meets WCAG A/AA and interaction budgets', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    const started = Date.now();
    await page.goto('/');
    await expect(page.locator('.company-card')).toHaveCount(50);
    const initialRenderMs = Date.now() - started;
    expect(initialRenderMs).toBeLessThan(8_000);

    await expect(page.locator('.skip-link')).toHaveAttribute('href', '#main');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await expectAccessible(page);

    const searchStarted = Date.now();
    await page.locator('#search').fill('三菱重工業');
    await expect(page.locator('.company-card')).toHaveCount(1);
    expect(Date.now() - searchStarted).toBeLessThan(1_500);

    await page.getByRole('button', { name: '条件をリセット' }).click();
    await expect(page.locator('.company-card')).toHaveCount(50);
    const filterStarted = Date.now();
    await page.locator('[data-strategy="capitalEfficiency"]').click();
    await expect(page.locator('[data-strategy="capitalEfficiency"]')).toHaveAttribute('aria-pressed', 'true');
    expect(Date.now() - filterStarted).toBeLessThan(1_500);

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
      const targets = await page.locator('button, a, input, select').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('placeholder'),
          width: rect.width,
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0,
        };
      }).filter(item => item.visible));
      const undersized = targets.filter(item => item.width < 24 || item.height < 24);
      expect(undersized, JSON.stringify(undersized, null, 2)).toEqual([]);
    }
    await expectNoErrors(errors);
  });

  test('quality dashboard meets WCAG A/AA and evidence-driven queue budgets', async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    const started = Date.now();
    await page.goto('/quality.html');
    await expect(page.locator('#queue-summary')).toBeVisible();
    const queueCount = await expectQueueSummary(page);
    expect(Date.now() - started).toBeLessThan(8_000);
    await expectAccessible(page);
    await expectQualitySummary(page);
    await expectQualityAudit(page);

    const filterStarted = Date.now();
    await page.locator('#queue-priority').selectOption('A');
    const priorityACount = await expectQueueSummary(page);
    expect(Date.now() - filterStarted).toBeLessThan(1_500);

    await page.locator('#queue-priority').selectOption('B');
    const priorityBCount = await expectQueueSummary(page);
    expect(priorityACount + priorityBCount).toBe(queueCount);
    if (queueCount > 0) expect(priorityACount).toBeGreaterThan(0);

    if (testInfo.project.name === 'mobile') {
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }
    await expectNoErrors(errors);
  });
});
