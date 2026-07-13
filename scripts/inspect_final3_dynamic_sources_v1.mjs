import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const TARGETS = {
  '5574': {
    name: 'ABEJA',
    urls: [
      'https://www.abejainc.com/ir-presentation',
      'https://www.abejainc.com/ir-result',
      'https://www.abejainc.com/ir-news',
    ],
  },
  '6723': {
    name: 'ルネサスエレクトロニクス',
    urls: [
      'https://www.renesas.com/en/about/investor-relations/financial-information',
      'https://www.renesas.com/en/about/investor-relations',
    ],
  },
  '8198': {
    name: 'マックスバリュ東海',
    urls: [
      'https://www.mv-tokai.co.jp/ir/data/material/',
      'https://www.mv-tokai.co.jp/ir/data/settlement-info/',
      'https://www.mv-tokai.co.jp/ir/irnews/',
    ],
  },
};

const findExecutable = () => {
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [command], { encoding: 'utf8' }).trim();
    } catch {}
  }
  return null;
};

const loadChromium = () => {
  try {
    return require('playwright-core').chromium;
  } catch {
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', 'playwright-core@1.55.0'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 120_000,
    });
    return require('playwright-core').chromium;
  }
};

const unique = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
const extractUrls = text => {
  const decoded = String(text || '')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
  const matches = decoded.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
  return [...new Set(matches.map(value => value.replace(/[),.;]+$/, '')))];
};
const interesting = value => /\.pdf(?:$|[?#])|xj-storage|eir-parts|irpocket|tdnet|financial|presentation|earnings|settlement|ir[-_/]|investor|api|wix|wp-json/i.test(value);

const executablePath = findExecutable();
if (!executablePath) throw new Error('Chrome/Chromium executable is required');
const chromium = loadChromium();
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36',
});

const report = {};
for (const [code, target] of Object.entries(TARGETS)) {
  const pages = [];
  const discoveredUrls = [];
  const responseFindings = [];
  for (const requestedUrl of target.urls) {
    const page = await context.newPage();
    const responses = [];
    page.on('response', async response => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      if (interesting(url) || /json|javascript|text|html|pdf/i.test(contentType)) {
        const item = { url, status: response.status(), contentType };
        try {
          const length = Number(response.headers()['content-length'] || 0);
          if (!length || length <= 5_000_000) {
            const body = await response.text();
            const urls = extractUrls(body).filter(interesting).slice(0, 120);
            const keywords = (body.match(/.{0,80}(?:決算説明|決算短信|financial results|presentation|earnings|\.pdf|xj-storage|eir-parts|irpocket).{0,160}/gi) || [])
              .map(value => value.replace(/\s+/g, ' ').slice(0, 300))
              .slice(0, 20);
            if (urls.length || keywords.length) {
              item.urls = urls;
              item.keywords = keywords;
            }
          }
        } catch {}
        responses.push(item);
      }
    });
    try {
      await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(4_000);
      for (const label of ['2026', '2025', '決算説明', '決算資料', 'Financial Results', 'Presentation']) {
        const locator = page.getByText(label, { exact: false });
        const count = await locator.count().catch(() => 0);
        for (let index = 0; index < Math.min(count, 3); index += 1) {
          await locator.nth(index).click({ timeout: 2_000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }
      const dom = await page.locator('a[href], iframe[src], embed[src], object[data], script[src]').evaluateAll(nodes => nodes.map(node => ({
        tag: node.tagName.toLowerCase(),
        text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        url: node.href || node.src || node.data || '',
      })));
      const html = await page.content();
      const htmlUrls = extractUrls(html).filter(interesting);
      const domUrls = dom.filter(row => row.url && interesting(row.url));
      discoveredUrls.push(...htmlUrls.map(url => ({ source: 'html', url, page: page.url() })));
      discoveredUrls.push(...domUrls.map(row => ({ source: row.tag, url: row.url, text: row.text, page: page.url() })));
      for (const response of responses) {
        if (response.urls?.length || response.keywords?.length || interesting(response.url)) responseFindings.push(response);
      }
      pages.push({
        requestedUrl,
        finalUrl: page.url(),
        title: await page.title(),
        htmlBytes: Buffer.byteLength(html, 'utf8'),
        domNodeCount: dom.length,
        interestingDom: domUrls.slice(0, 160),
        htmlUrls: htmlUrls.slice(0, 160),
        responseCount: responses.length,
      });
    } catch (error) {
      pages.push({ requestedUrl, error: String(error) });
    } finally {
      await page.close();
    }
  }
  report[code] = {
    name: target.name,
    pages,
    discoveredUrls: unique(discoveredUrls).slice(0, 500),
    responseFindings: unique(responseFindings).slice(0, 300),
  };
}
await browser.close();

const output = {
  version: 'final3-dynamic-source-diagnostics-v1',
  generatedAt: new Date().toISOString(),
  executablePath,
  companies: report,
};
const outputPath = path.join(ROOT, 'artifacts', 'final3-dynamic-source-diagnostics-v1.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

const qualityPath = path.join(ROOT, 'artifacts', 'quality-report-v43.json');
if (fs.existsSync(qualityPath)) {
  const quality = JSON.parse(fs.readFileSync(qualityPath, 'utf8'));
  quality.final3DynamicSourceDiagnostics = output;
  fs.writeFileSync(qualityPath, `${JSON.stringify(quality, null, 2)}\n`);
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([code, row]) => [code, {
  pages: row.pages.length,
  discoveredUrls: row.discoveredUrls.length,
  responseFindings: row.responseFindings.length,
}])), null, 2));
