import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'phase3-production.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-production-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-production-report', open: 'never' }]],
  use: {
    baseURL: process.env.CHUKEI_PRODUCTION_URL || 'https://chu-kei.com',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
});
