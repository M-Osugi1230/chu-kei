import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const MAX_PAGES = 12;
const CONCURRENCY = 3;
const INTERNAL_PATTERN = /ir|investor|financial|library|result|report|presentation|document|material|settlement|earnings|決算|説明|資料|経営|統合報告|有価証券|株主|投資家/i;
const TARGET_PAGES = {
  '5574': ['https://www.abejainc.com/ir-top', 'https://www.abejainc.com/ir-presentation', 'https://www.abejainc.com/ir-result', 'https://www.abejainc.com/ir-news'],
  '6146': ['https://www.disco.co.jp/jp/ir/library/'],
  '6264': ['https://www.marumae.com/ir.html', 'https://www.marumae.com/ir_4.html', 'https://www.marumae.com/ir_9.html'],
  '6273': ['https://www.smcworld.com/ir/ja-jp/', 'https://www.smcworld.com/ir/ja-jp/briefing-materials.html', 'https://www.smcworld.com/ir/ja-jp/financial-results.html', 'https://www.smcworld.com/ir/ja-jp/annual-report.html'],
  '6338': ['https://www.takatori-g.co.jp/ir/', 'https://www.takatori-g.co.jp/ir/tanshin/index.html'],
  '6613': ['https://www.qdlaser.com/ir/', 'https://www.qdlaser.com/ir/library/'],
  '6723': ['https://www.renesas.com/ja/about/investor-relations', 'https://www.renesas.com/ja/about/investor-relations/event/presentation', 'https://www.renesas.com/ja/about/investor-relations/financial-information'],
  '7741': ['https://www.hoya.com/investor/', 'https://www.hoya.com/investor/library/', 'https://www.hoya.com/investor/annual/'],
  '8198': ['https://www.mv-tokai.co.jp/ir/', 'https://www.mv-tokai.co.jp/ir/data/', 'https://www.mv-tokai.co.jp/ir/data/material/', 'https://www.mv-tokai.co.jp/ir/data/settlement-info/'],
  '9761': ['https://tokai-lease.co.jp/ir/', 'https://tokai-lease.co.jp/ir/ir_library/'],
};

const findExecutable = () => {
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [command], { encoding: 'utf8' }).trim(); } catch {}
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
const normalizeHost = value => new URL(value).hostname.toLowerCase().replace(/^www\./, '');

const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const companies = payload.companies
  .filter(company => company.stage === 'source_indexed')
  .map(company => ({ code: String(company.code), name: company.name, startUrl: company.sourceUrl }));
if (companies.length !== 10) throw new Error(`Expected 10 source-indexed companies, got ${companies.length}`);

const executablePath = findExecutable();
const outputPath = path.join(ROOT, 'artifacts', 'final10-browser-links-v1.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
if (!executablePath) {
  fs.writeFileSync(outputPath, `${JSON.stringify({ version: 'final10-browser-links-v1', executablePath: null, companies: {} }, null, 2)}\n`);
  console.log('No system Chrome/Chromium found; browser fallback skipped.');
  process.exit(0);
}

const chromium = loadChromium();
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ja-JP', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36' });
const report = {};
let cursor = 0;

const processCompany = async company => {
  const startHost = normalizeHost(company.startUrl);
  const queue = [...new Set([...(TARGET_PAGES[company.code] || []), company.startUrl])];
  const visited = new Set();
  const pages = [];
  while (queue.length && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const page = await context.newPage();
    const responses = [];
    page.on('response', response => {
      const responseUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      if (/pdf|zip|octet-stream/i.test(contentType) || /\.(?:pdf|zip)(?:$|[?#])/i.test(responseUrl)) responses.push({ url: responseUrl, contentType });
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForTimeout(2_000);
      const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => ({
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        url: anchor.href,
      })));
      pages.push({ url: page.url(), title: await page.title(), links, responses });
      for (const link of links) {
        try {
          const host = normalizeHost(link.url);
          const sameSite = host === startHost || host.endsWith(`.${startHost}`);
          if (sameSite && !/\.(?:pdf|zip)(?:$|[?#])/i.test(link.url) && INTERNAL_PATTERN.test(`${link.text} ${link.url}`) && !visited.has(link.url) && queue.length < 40) {
            queue.push(link.url);
          }
        } catch {}
      }
    } catch (error) {
      pages.push({ url, error: String(error), links: [], responses });
    } finally {
      await page.close();
    }
  }
  report[company.code] = { ...company, canonicalTargetPages: TARGET_PAGES[company.code] || [], pages };
};

const worker = async () => {
  while (true) {
    const index = cursor++;
    if (index >= companies.length) return;
    await processCompany(companies[index]);
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, companies.length) }, () => worker()));
await browser.close();

const output = { version: 'final10-browser-links-v2', generatedAt: new Date().toISOString(), executablePath, companies: report };
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

const diagnostics = {};
for (const [code, company] of Object.entries(report)) {
  const pdfLinks = [];
  for (const page of company.pages || []) {
    for (const link of page.links || []) {
      if (/\.(?:pdf|zip)(?:$|[?#])/i.test(link.url)) pdfLinks.push({ url: link.url, text: link.text || '', host: normalizeHost(link.url), sourcePage: page.url });
    }
    for (const response of page.responses || []) {
      if (/\.(?:pdf|zip)(?:$|[?#])/i.test(response.url) || /pdf|zip|octet-stream/i.test(response.contentType || '')) pdfLinks.push({ url: response.url, text: 'network response', host: normalizeHost(response.url), sourcePage: page.url, contentType: response.contentType || '' });
    }
  }
  diagnostics[code] = {
    name: company.name,
    startUrl: company.startUrl,
    canonicalTargetPages: company.canonicalTargetPages,
    pages: (company.pages || []).map(page => ({ url: page.url, title: page.title || '', error: page.error || null, linkCount: (page.links || []).length, responsePdfCount: (page.responses || []).length })),
    pdfLinks: [...new Map(pdfLinks.map(item => [item.url, item])).values()].slice(0, 220),
  };
}
const qualityPath = path.join(ROOT, 'artifacts', 'quality-report-v43.json');
if (fs.existsSync(qualityPath)) {
  const quality = JSON.parse(fs.readFileSync(qualityPath, 'utf8'));
  quality.final10BrowserLinkDiagnostics = { version: 'final10-browser-link-diagnostics-v2', executablePath, companies: diagnostics };
  fs.writeFileSync(qualityPath, `${JSON.stringify(quality, null, 2)}\n`);
}
console.log(JSON.stringify({ companies: Object.keys(report).length, executablePath, pages: Object.values(report).reduce((sum, row) => sum + row.pages.length, 0), documents: Object.values(diagnostics).reduce((sum, row) => sum + row.pdfLinks.length, 0) }, null, 2));
