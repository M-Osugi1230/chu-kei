import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const QUEUE_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-priority-queue.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-official-discovery.json');
const MAX_PAGES = 4;
const CONCURRENCY = 5;
const INTERNAL_PATTERN = /ir|investor|financial|library|result|report|presentation|document|material|settlement|earnings|決算|説明|資料|経営|中期|統合報告|有価証券/i;
const PDF_HOST_PATTERN = /xj-storage|eir-parts|irpocket|tdnet|\.pdf(?:$|[?#])/i;

const START_URLS = {
  '3635': ['https://www.koeitecmo.co.jp/ir/', 'https://www.koeitecmo.co.jp/'],
  '3661': ['https://m-upholdings.co.jp/ir/', 'https://m-upholdings.co.jp/'],
  '3962': ['https://www.changeholdings.co.jp/ir/', 'https://www.changeholdings.co.jp/'],
  '2127': ['https://www.nihon-ma.co.jp/groups/ir/', 'https://www.nihon-ma.co.jp/'],
  '2146': ['https://www.ut-g.co.jp/ir/', 'https://www.ut-g.co.jp/'],
  '2153': ['https://www.ej-hds.co.jp/ir/', 'https://www.ej-hds.co.jp/'],
  '4004': ['https://www.resonac.com/jp/corporate/ir', 'https://www.resonac.com/jp/'],
  '3231': ['https://www.nomura-re-hd.co.jp/ir/', 'https://www.nomura-re-hd.co.jp/'],
  '3288': ['https://openhouse-group.co.jp/ir/', 'https://openhouse-group.co.jp/'],
  '3289': ['https://www.tokyu-fudosan-hd.co.jp/ir/', 'https://www.tokyu-fudosan-hd.co.jp/'],
  '2784': ['https://www.alfresa.com/ir/', 'https://www.alfresa.com/'],
  '3107': ['https://www.daiwabo-holdings.com/ja/ir/', 'https://www.daiwabo-holdings.com/'],
  '3132': ['https://www.macnica.co.jp/company/ir/', 'https://www.macnica.co.jp/'],
  '1414': ['https://www.sho-bondhd.jp/ir/', 'https://www.sho-bondhd.jp/'],
  '1721': ['https://www.comsys-hd.co.jp/ir/', 'https://www.comsys-hd.co.jp/'],
  '2321': ['https://www.softfront.co.jp/ir/', 'https://www.softfront.co.jp/'],
  '3300': ['https://www.am-bition.jp/ir/', 'https://www.am-bition.jp/'],
  '3070': ['https://www.jelly-beans-group.co.jp/ir/', 'https://www.jelly-beans-group.co.jp/'],
  '9326': ['https://www.kantsu-hd.co.jp/ir/', 'https://www.kantsu-hd.co.jp/'],
  '4011': ['https://www.headwaters.co.jp/ir/', 'https://www.headwaters.co.jp/'],
  '4651': ['https://sanix-hd.co.jp/ir/', 'https://sanix-hd.co.jp/'],
  '6035': ['https://www.irjapan-hd.com/ir/', 'https://www.irjapan-hd.com/'],
  '6082': ['https://www.rideonexpresshd.co.jp/ir/', 'https://www.rideonexpresshd.co.jp/'],
  '3113': ['https://univa-oak.com/ir/', 'https://univa-oak.com/'],
  '4994': ['https://www.taiseilamick.co.jp/ir/', 'https://www.lamick.co.jp/ir/', 'https://www.taiseilamick.co.jp/'],
};

const findExecutable = () => {
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [command], { encoding: 'utf8' }).trim(); } catch {}
  }
  return null;
};
const loadChromium = () => {
  try { return require('playwright-core').chromium; } catch {
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', 'playwright-core@1.55.0'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 120_000,
    });
    return require('playwright-core').chromium;
  }
};
const normalizeHost = value => {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};
const uniqueByUrl = rows => [...new Map(rows.filter(row => row.url).map(row => [row.url, row])).values()];
const candidateScore = row => {
  const value = `${row.text || ''} ${row.url || ''}`;
  let score = 0;
  if (/2026|令和8/i.test(value)) score += 35;
  else if (/2025|令和7/i.test(value)) score += 18;
  if (/中期|経営計画|medium.?term|strategy|vision/i.test(value)) score += 32;
  if (/決算説明|financial results|earnings presentation|presentation/i.test(value)) score += 28;
  if (/統合報告|integrated report/i.test(value)) score += 18;
  if (/\.pdf(?:$|[?#])/i.test(row.url || '')) score += 12;
  if (/xj-storage|eir-parts|irpocket/i.test(row.url || '')) score += 8;
  if (/招集通知|株主総会|定款|大量保有|月次|自己株式の取得状況/i.test(value)) score -= 35;
  return score;
};

const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
const selectedByCode = new Map(queue.selected.map(row => [String(row.code), row]));
if (selectedByCode.size !== 25) throw new Error(`Expected 25 selected companies, got ${selectedByCode.size}`);
for (const code of selectedByCode.keys()) if (!START_URLS[code]) throw new Error(`Missing start URL mapping: ${code}`);

const executablePath = findExecutable();
if (!executablePath) throw new Error('Chrome/Chromium executable is required');
const chromium = loadChromium();
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36',
});

const results = {};
let cursor = 0;
const companies = queue.selected;

const processCompany = async company => {
  const code = String(company.code);
  const startUrls = START_URLS[code];
  const allowedHosts = new Set(startUrls.map(normalizeHost).filter(Boolean));
  const queueUrls = [...startUrls];
  const visited = new Set();
  const pages = [];
  const links = [];

  while (queueUrls.length && visited.size < MAX_PAGES) {
    const requestedUrl = queueUrls.shift();
    if (visited.has(requestedUrl)) continue;
    visited.add(requestedUrl);
    const page = await context.newPage();
    const responsePdfs = [];
    page.on('response', response => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      if (/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(url)) responsePdfs.push({ url, text: 'network response', sourcePage: requestedUrl });
    });
    try {
      const response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForTimeout(1_000);
      const pageLinks = await page.locator('a[href], iframe[src], embed[src], object[data]').evaluateAll(nodes => nodes.map(node => ({
        text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220),
        url: node.href || node.src || node.data || '',
      })));
      const finalUrl = page.url();
      const title = await page.title();
      pages.push({ requestedUrl, finalUrl, status: response?.status() ?? null, title, linkCount: pageLinks.length });
      for (const link of [...pageLinks, ...responsePdfs]) {
        if (!link.url) continue;
        const row = { ...link, sourcePage: link.sourcePage || finalUrl };
        if (PDF_HOST_PATTERN.test(link.url) || INTERNAL_PATTERN.test(`${link.text} ${link.url}`)) links.push(row);
        const host = normalizeHost(link.url);
        const sameOfficialSite = [...allowedHosts].some(allowed => host === allowed || host.endsWith(`.${allowed}`) || allowed.endsWith(`.${host}`));
        if (sameOfficialSite && !/\.pdf(?:$|[?#])/i.test(link.url) && INTERNAL_PATTERN.test(`${link.text} ${link.url}`) && !visited.has(link.url) && queueUrls.length < 20) {
          queueUrls.push(link.url);
        }
      }
    } catch (error) {
      pages.push({ requestedUrl, error: String(error) });
    } finally {
      await page.close();
    }
  }

  const rankedLinks = uniqueByUrl(links)
    .map(row => ({ ...row, score: candidateScore(row), host: normalizeHost(row.url) }))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, 12);
  const successfulPages = pages.filter(page => !page.error && page.status != null && page.status < 400).length;
  const recentCandidates = rankedLinks.filter(row => row.score >= 30).length;
  const pdfCandidates = rankedLinks.filter(row => /\.pdf(?:$|[?#])/i.test(row.url) || /xj-storage|eir-parts|irpocket/i.test(row.url)).length;
  const sourceStrength = successfulPages * 8 + recentCandidates * 5 + pdfCandidates * 3;
  results[code] = {
    code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    priorityScore: company.score,
    startUrls,
    pages,
    officialIrUrl: pages.find(page => !page.error && page.status < 400)?.finalUrl || null,
    sourceStrength,
    recentCandidates,
    pdfCandidates,
    rankedLinks,
  };
};

const worker = async () => {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= companies.length) return;
    await processCompany(companies[index]);
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, companies.length) }, () => worker()));
await browser.close();

const rankedCompanies = Object.values(results)
  .map(row => ({
    code: row.code,
    name: row.name,
    market: row.market,
    industry: row.industry,
    priorityScore: row.priorityScore,
    sourceStrength: row.sourceStrength,
    combinedScore: row.priorityScore + row.sourceStrength,
    officialIrUrl: row.officialIrUrl,
    recentCandidates: row.recentCandidates,
    pdfCandidates: row.pdfCandidates,
  }))
  .sort((a, b) => b.combinedScore - a.combinedScore || b.sourceStrength - a.sourceStrength || a.code.localeCompare(b.code));

const selectedForDetailedResearch = [];
const industryCounts = new Map();
for (const company of rankedCompanies) {
  if (selectedForDetailedResearch.length >= 15) break;
  if (company.sourceStrength < 8) continue;
  const count = industryCounts.get(company.industry) || 0;
  if (count >= 4) continue;
  selectedForDetailedResearch.push(company);
  industryCounts.set(company.industry, count + 1);
}
for (const company of rankedCompanies) {
  if (selectedForDetailedResearch.length >= 15) break;
  if (selectedForDetailedResearch.some(row => row.code === company.code)) continue;
  selectedForDetailedResearch.push(company);
}

const report = {
  version: 'batch14-official-ir-discovery-v1',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: queue.sourceBundleSha256,
  selectedCompanyCount: companies.length,
  detailedResearchCount: selectedForDetailedResearch.length,
  selectedForDetailedResearch,
  rankedCompanies,
  companies: results,
};
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  selectedCompanyCount: report.selectedCompanyCount,
  detailedResearchCount: report.detailedResearchCount,
  selectedForDetailedResearch,
  failures: Object.values(results).filter(row => !row.officialIrUrl).map(row => ({ code: row.code, name: row.name, startUrls: row.startUrls })),
}, null, 2));
