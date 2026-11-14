import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { matchesSearchQuery } from '../../site/assets/search-core.js';

const fileUrl = (path) => new URL(`../../${path}`, import.meta.url);
const readJson = (path) => JSON.parse(fs.readFileSync(fileUrl(path), 'utf8'));
const manifest = readJson('site/data/frontend/manifest.json');
const universe = readJson('operations/universe/current-universe-v1.json');

function readVerifiedCompressed(descriptor) {
  const bytes = fs.readFileSync(fileUrl(`site/data/frontend/${descriptor.file}`));
  expect(bytes.byteLength, `${descriptor.file} size`).toBe(descriptor.bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  expect(hash, `${descriptor.file} SHA-256`).toBe(descriptor.sha256);
  return JSON.parse(gunzipSync(bytes).toString('utf8'));
}

test.describe('Complete universe search and detail coverage', () => {
  test('all canonical companies appear exactly once in the searchable index and detail shards', () => {
    expect(manifest.version).toBe('frontend-data-manifest-v1');
    expect(universe.version).toBe('company-universe-v1');
    expect(manifest.companyCount).toBe(universe.companyCount);
    expect(manifest.universeCompanyCount).toBe(universe.companyCount);

    const index = readVerifiedCompressed(manifest.index);
    expect(index.version).toBe('frontend-company-index-v1');
    expect(index.companies).toHaveLength(manifest.companyCount);

    const universeCodes = new Set(universe.companies.map((company) => String(company.code)));
    const indexCodes = new Set();
    const indexFileByCode = new Map();

    for (const company of index.companies) {
      const code = String(company.code);
      expect(indexCodes.has(code), `duplicate indexed code ${code}`).toBe(false);
      expect(universeCodes.has(code), `unlisted indexed code ${code}`).toBe(true);
      expect(matchesSearchQuery(company, code), `code not searchable ${code}`).toBe(true);
      expect(typeof company.detailFile).toBe('string');
      indexCodes.add(code);
      indexFileByCode.set(code, company.detailFile);
    }
    expect(indexCodes.size).toBe(universeCodes.size);
    for (const code of universeCodes) {
      expect(indexCodes.has(code), `missing searchable company ${code}`).toBe(true);
    }

    const detailCodes = new Set();
    let totalDetailRows = 0;
    for (const descriptor of manifest.detailShards) {
      const shard = readVerifiedCompressed(descriptor);
      expect(shard.version).toBe('frontend-company-details-v1');
      expect(shard.companies).toHaveLength(descriptor.companyCount);
      expect(String(shard.companies[0]?.code)).toBe(descriptor.firstCode);
      expect(String(shard.companies.at(-1)?.code)).toBe(descriptor.lastCode);

      for (const company of shard.companies) {
        const code = String(company.code);
        expect(detailCodes.has(code), `duplicate detail code ${code}`).toBe(false);
        expect(indexFileByCode.get(code), `incorrect detail shard for ${code}`).toBe(descriptor.file);
        detailCodes.add(code);
      }
      totalDetailRows += shard.companies.length;
    }

    expect(totalDetailRows).toBe(manifest.companyCount);
    expect(detailCodes.size).toBe(universeCodes.size);
    for (const code of universeCodes) {
      expect(detailCodes.has(code), `missing company detail ${code}`).toBe(true);
    }
  });

  test('browser can find and open Prime, Standard, Growth, and edge-company records', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    await page.goto('/');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#stat-total')).toHaveText(`${manifest.companyCount}社`);
    await expect(page.locator('#result-summary')).toContainText(`${manifest.companyCount}社が該当`);

    const byCode = new Map(universe.companies.map((company) => [String(company.code), company]));
    const samples = ['1301', '130A', '7011', '9996', '9997'];

    for (const code of samples) {
      const company = byCode.get(code);
      expect(company, `missing universe sample ${code}`).toBeTruthy();

      await page.locator('#market').selectOption(company.market);
      await page.locator('#search').fill(code);
      await expect(page.locator('#result-summary')).toContainText('1社が該当');
      await expect(page.locator('.company-card')).toHaveCount(1);
      await expect(page.locator('.company-card')).toContainText(company.name);

      await page.locator('[data-detail]').first().click();
      await expect(page.locator('#company-dialog')).toBeVisible();
      await expect(page.locator('#company-dialog h2')).toContainText(company.name);
      await page.locator('#company-dialog [data-close]').click();
      await expect(page.locator('#company-dialog')).toBeHidden();
    }

    await page.locator('#search').fill('');
    await page.locator('#market').selectOption('');
    await expect(page.locator('#result-summary')).toContainText(`${manifest.companyCount}社が該当`);
    expect(pageErrors).toEqual([]);
  });

  test('JPX listing-only data never displays its fetch date as a plan review date', async ({ page }) => {
    await page.goto('/');
    await page.locator('#stage').selectOption('jpx_indexed');
    await expect(page.locator('.company-card')).toHaveCount(50);
    await expect(page.locator('.company-card').first()).toContainText('中計未確認');
    await expect(page.locator('.company-card').first()).toContainText('上場情報取得日');
    await expect(page.locator('.company-card').first()).not.toContainText('最終確認日');

    await page.locator('[data-detail]').first().click();
    await expect(page.locator('#company-dialog')).toBeVisible();
    await expect(page.locator('#company-detail')).toContainText('上場情報取得日');
    await expect(page.locator('#company-detail')).toContainText('中計未確認');
    await expect(page.locator('#company-detail')).not.toContainText('最終確認日');
  });

  test('release dashboard separates current searchable companies from legacy source and unreviewed plans', async ({ page }) => {
    const summary = readJson('site/data/plan-detection-summary-v1.json');
    await page.goto('/release.html');
    await expect(page.locator('#release-error')).toBeHidden();
    await expect(page.locator('#repo-stats')).toContainText('現行検索対象');
    await expect(page.locator('#repo-stats')).toContainText(String(manifest.companyCount));
    await expect(page.locator('#repo-stats')).toContainText('正式中計判定済み');
    await expect(page.locator('#repo-stats')).toContainText(String(summary.resolvedCount));
    await expect(page.locator('#repo-stats')).toContainText('中計未確認');
    await expect(page.locator('#repo-stats')).toContainText(String(summary.pendingCount));
    await expect(page.locator('#repo-stats')).toContainText('既存の構造化元データ');
    await expect(page.locator('#release-updated')).toContainText('JPX企業一覧取得');
    await expect(page.locator('#pending-sync')).toContainText('公開済みホスティング');
  });
});
