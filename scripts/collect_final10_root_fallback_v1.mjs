import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const LINKS_PATH = path.join(ROOT, 'artifacts', 'final10-browser-links-v1.json');
const MAX_EXTRA_PAGES = 7;
const CONCURRENCY = 3;
const INTERNAL_PATTERN = /ir|investor|financial|library|result|report|presentation|document|material|settlement|earnings|決算|説明|資料|経営|統合報告|有価証券|株主|投資家/i;
const normalizeHost = value => new URL(value).hostname.toLowerCase().replace(/^www\./, '');
const findExecutable = () => {
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [command], { encoding: 'utf8' }).trim(); } catch {}
  }
  return null;
};
const countPdfLinks = company => (company.pages || []).reduce((count, page) => count
  + (page.links || []).filter(link => /\.pdf(?:$|[?#])/i.test(link.url)).length
  + (page.responses || []).filter(response => /pdf/i.test(response.contentType || '') || /\.pdf(?:$|[?#])/i.test(response.url)).length, 0);

if (!fs.existsSync(LINKS_PATH)) process.exit(0);
const payload = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
const targets = Object.values(payload.companies || {}).filter(company => countPdfLinks(company) === 0);
const executablePath = findExecutable();
if (!executablePath || targets.length === 0) process.exit(0);
const chromium = require('playwright-core').chromium;
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ locale: 'ja-JP', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36' });
let cursor = 0;

const processCompany = async company => {
  const start = new URL(company.startUrl);
  const startHost = normalizeHost(company.startUrl);
  const rootUrl = `${start.protocol}//${start.host}/`;
  const guessed = [rootUrl, new URL('/ir/', rootUrl).href, new URL('/investor-relations/', rootUrl).href, new URL('/investors/', rootUrl).href];
  const queue = [...new Set(guessed)];
  const visited = new Set((company.pages || []).map(page => page.url));
  const added = [];
  while (queue.length && added.length < MAX_EXTRA_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const page = await context.newPage();
    const responses = [];
    page.on('response', response => {
      const responseUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      if (/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(responseUrl)) responses.push({ url: responseUrl, contentType });
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(1_000);
      const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => ({ text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(), url: anchor.href })));
      added.push({ url: page.url(), title: await page.title(), links, responses });
      for (const link of links) {
        try {
          const host = normalizeHost(link.url);
          const sameSite = host === startHost || host.endsWith(`.${startHost}`);
          if (sameSite && !/\.pdf(?:$|[?#])/i.test(link.url) && INTERNAL_PATTERN.test(`${link.text} ${link.url}`) && !visited.has(link.url) && queue.length < 30) queue.push(link.url);
        } catch {}
      }
    } catch (error) {
      added.push({ url, error: String(error), links: [], responses });
    } finally {
      await page.close();
    }
  }
  company.pages = [...(company.pages || []), ...added];
};
const worker = async () => {
  while (true) {
    const index = cursor++;
    if (index >= targets.length) return;
    await processCompany(targets[index]);
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));
await browser.close();
fs.writeFileSync(LINKS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ targets: targets.length, extraPages: targets.reduce((sum, company) => sum + (company.pages || []).length, 0) }, null, 2));
