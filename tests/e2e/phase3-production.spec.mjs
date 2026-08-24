import { test, expect } from '@playwright/test';

const EXPECTED_CORRECTED_SOURCE_FRAGMENT = 'contents.xj-storage.jp/xcontents/AS09259/46652e9d/01a6/4eac/9e2f/d2f95cfb93c6/140120260317583980.pdf';

function parseJapaneseCompanyCount(text) {
  const match = text.match(/([0-9][0-9,]*)社収録企業/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

function parseDetailedCount(text) {
  const match = text.match(/([0-9][0-9,]*)社詳しい情報あり/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

function parseDataUpdateLabel(text) {
  const match = text.match(/データ更新日\s*([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日|[0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return match?.[1] ?? null;
}

async function findCompanyCard(page) {
  const heading = page.getByRole('heading', { name: 'ムービン・ストラテジック・キャリア', exact: true });
  await expect(heading).toBeVisible();

  const article = heading.locator('xpath=ancestor::article[1]');
  if (await article.count()) return article;

  return heading.locator('xpath=ancestor::div[1]');
}

test.describe('Phase 3 production verification', () => {
  test('observes the current public release baseline without treating it as repository truth', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const bodyText = await page.locator('body').innerText();

    const observation = {
      productionUrl: page.url(),
      publishedCompanyCount: parseJapaneseCompanyCount(bodyText),
      publishedDetailedCompanyCount: parseDetailedCount(bodyText),
      dataUpdateLabel: parseDataUpdateLabel(bodyText),
      repositoryExpectedCompanyCount: 3000,
      alignmentRequired: process.env.REQUIRE_PHASE3_PRODUCTION_ALIGNMENT === 'true',
    };

    await testInfo.attach('phase3-production-observation.json', {
      body: Buffer.from(`${JSON.stringify(observation, null, 2)}\n`),
      contentType: 'application/json',
    });

    expect(observation.publishedCompanyCount).not.toBeNull();
    expect(observation.publishedDetailedCompanyCount).not.toBeNull();

    if (observation.alignmentRequired) {
      expect(observation.publishedCompanyCount).toBeGreaterThanOrEqual(observation.repositoryExpectedCompanyCount);
    }
  });

  test('421A exposes the corrected source and renders the reviewed targets in production', async ({ page, request }, testInfo) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const search = page.getByPlaceholder(/企業名・証券コード/).first();
    await expect(search).toBeVisible();
    await search.fill('421A');

    const card = await findCompanyCard(page);
    await expect(card).toContainText('421A');
    await expect(card).toContainText('2028年12月期');
    await expect(card).toContainText('売上100億円');
    await expect(card).toContainText('営業利益46億円');

    const detailTrigger = card.getByText(/計画の要点を見る|詳細を見る/, { exact: false }).first();
    await expect(detailTrigger).toBeVisible();
    await detailTrigger.click();

    await expect(page.getByText('ムービン・ストラテジック・キャリア', { exact: true }).last()).toBeVisible();
    await expect(page.locator('body')).toContainText('100億円');
    await expect(page.locator('body')).toContainText('46億円');

    const correctedSource = page.locator(`a[href*="${EXPECTED_CORRECTED_SOURCE_FRAGMENT}"]`).first();
    await expect(correctedSource).toBeVisible();
    const href = await correctedSource.getAttribute('href');
    expect(href).toContain(EXPECTED_CORRECTED_SOURCE_FRAGMENT);

    const response = await request.get(href, { timeout: 30_000 });
    expect(response.ok()).toBeTruthy();
    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType.toLowerCase()).toContain('pdf');

    const evidence = {
      company: '421A',
      correctedSourceHref: href,
      sourceHttpStatus: response.status(),
      sourceContentType: contentType,
      reviewedTargetsVisible: true,
    };
    await testInfo.attach('421A-production-evidence.json', {
      body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
      contentType: 'application/json',
    });
  });
});
