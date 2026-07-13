import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const QUEUE_PATH = path.join(ROOT, 'operations', 'research', 'source-coverage-50-queue.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research', 'source-coverage-50-discovery.json');
const CONCURRENCY = Number(process.env.SOURCE_DISCOVERY_CONCURRENCY || 6);
const SEARCH_TIMEOUT_MS = 12_000;
const PAGE_TIMEOUT_MS = 15_000;
const MAX_RESULT_CANDIDATES = 8;
const MAX_INTERNAL_PAGES = 3;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36';

const KNOWN_START_URLS = {
  '3635': ['https://www.koeitecmo.co.jp/ir/'],
  '3661': ['https://m-upholdings.co.jp/ir/'],
  '3962': ['https://www.changeholdings.co.jp/ir/'],
  '2127': ['https://www.nihon-ma.co.jp/groups/ir/'],
  '2146': ['https://www.ut-g.co.jp/ir/'],
  '2153': ['https://www.ej-hds.co.jp/ir/'],
  '4004': ['https://www.resonac.com/jp/corporate/ir'],
  '3231': ['https://www.nomura-re-hd.co.jp/ir/'],
  '3288': ['https://openhouse-group.co.jp/ir/'],
  '3289': ['https://www.tokyu-fudosan-hd.co.jp/ir/'],
  '2784': ['https://www.alfresa.com/ir/'],
  '3107': ['https://www.daiwabo-holdings.com/ja/ir/'],
  '3132': ['https://www.macnica.co.jp/company/ir/'],
  '1414': ['https://www.sho-bondhd.jp/ir/'],
  '1721': ['https://www.comsys-hd.co.jp/ir/'],
  '2321': ['https://www.softfront.co.jp/ir/'],
  '3300': ['https://www.am-bition.jp/ir/'],
  '3070': ['https://www.jelly-beans-group.co.jp/ir/'],
  '9326': ['https://www.kantsu-hd.co.jp/ir/'],
  '4011': ['https://www.headwaters.co.jp/ir/'],
  '4651': ['https://sanix-hd.co.jp/ir/'],
  '6035': ['https://www.irjapan-hd.com/ir/'],
  '6082': ['https://www.rideonexpresshd.co.jp/ir/'],
  '3113': ['https://univa-oak.com/ir/'],
  '4994': ['https://www.taiseilamick.co.jp/ir/', 'https://www.lamick.co.jp/ir/'],
};

const EXCLUDED_HOST = /(?:^|\.)(?:jpx\.co\.jp|www2\.jpx\.co\.jp|yahoo\.co\.jp|google\.|bing\.com|duckduckgo\.com|nikkei\.com|kabutan\.jp|minkabu\.jp|buffett-code\.com|irbank\.net|ullet\.com|bloomberg\.|reuters\.|prtimes\.jp|wantedly\.com|wikipedia\.org|note\.com|x\.com|twitter\.com|facebook\.com|linkedin\.com|indeed\.|openwork\.jp|jobtalk\.jp|rakuten-sec\.co\.jp|monex\.co\.jp|sbisec\.co\.jp)$/i;
const DISTRIBUTION_HOST = /xj-storage|eir-parts|irpocket|tdnet|svss\.tv/i;
const IR_PATTERN = /(?:^|[\/_-])ir(?:[\/_-]|$)|investor|financial|finance|library|result|report|presentation|document|material|settlement|earnings|決算|説明資料|経営計画|中期|統合報告/i;
const DOCUMENT_PATTERN = /中期|経営計画|medium.?term|strategy|vision|決算説明|financial results|earnings presentation|presentation|統合報告|integrated report|決算短信|financial statements/i;
const NEGATIVE_PATTERN = /招集通知|株主総会|定款|大量保有|自己株式の取得状況|月次|人事異動|訃報|訂正のみ|コーポレート・ガバナンス報告書/i;

const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stripTags = value => String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const decodeHtml = value => String(value || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
const normalizeText = value => decodeHtml(stripTags(value)).normalize('NFKC').replace(/[\s　・･.,，。()（）\[\]【】「」『』]/g, '').toLowerCase();
const normalizeHost = value => {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};
const isExcluded = value => {
  const host = normalizeHost(value);
  return !host || EXCLUDED_HOST.test(host);
};
const sameSite = (left, right) => {
  const a = normalizeHost(left);
  const b = normalizeHost(right);
  return a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
};
const uniqueByUrl = rows => [...new Map(rows.filter(row => row.url).map(row => [row.url, row])).values()];

async function fetchResponse(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'ja,en-US;q=0.8,en;q=0.6',
        accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(url, timeoutMs = PAGE_TIMEOUT_MS) {
  const response = await fetchResponse(url, timeoutMs);
  const contentType = response.headers.get('content-type') || '';
  const finalUrl = response.url || url;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(finalUrl)) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') throw new Error('PDF signature missing');
    return { type: 'pdf', finalUrl, contentType, bytes: bytes.length, text: '', title: '' };
  }
  const text = await response.text();
  return {
    type: 'html',
    finalUrl,
    contentType,
    text: text.slice(0, 1_500_000),
    title: decodeHtml((text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''),
  };
}

function parseBingRss(xml) {
  const rows = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const url = decodeHtml((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const title = decodeHtml(stripTags((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ''));
    const snippet = decodeHtml(stripTags((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || ''));
    if (url) rows.push({ url, title, snippet, provider: 'bing-rss' });
  }
  return rows;
}

function parseDuckDuckGo(html) {
  const rows = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url = decodeHtml(match[1]);
    const title = decodeHtml(stripTags(match[2]));
    try {
      const parsed = new URL(url, 'https://html.duckduckgo.com');
      if (parsed.searchParams.get('uddg')) url = decodeURIComponent(parsed.searchParams.get('uddg'));
    } catch {}
    if (/^https?:\/\//i.test(url) && title) rows.push({ url, title, snippet: '', provider: 'duckduckgo' });
  }
  return rows;
}

async function searchWeb(query) {
  const encoded = encodeURIComponent(query);
  const attempts = [
    { url: `https://www.bing.com/search?format=rss&q=${encoded}`, parser: parseBingRss },
    { url: `https://html.duckduckgo.com/html/?q=${encoded}`, parser: parseDuckDuckGo },
  ];
  for (const attempt of attempts) {
    try {
      const response = await fetchResponse(attempt.url, SEARCH_TIMEOUT_MS);
      if (!response.ok) continue;
      const rows = attempt.parser(await response.text());
      if (rows.length) return rows;
    } catch {}
  }
  return [];
}

function nameVariants(company) {
  const full = normalizeText(company.name);
  const stripped = normalizeText(String(company.name || '')
    .replace(/株式会社|（株）|㈱/g, '')
    .replace(/ホールディングス|ホールディング|ＨＤ|HD|グループ|Group/gi, ''));
  return [...new Set([full, stripped].filter(value => value.length >= 3))];
}

function searchResultScore(company, row) {
  if (isExcluded(row.url)) return -1000;
  const value = normalizeText(`${row.title} ${row.snippet} ${row.url}`);
  const variants = nameVariants(company);
  let score = 0;
  if (variants.some(name => value.includes(name))) score += 45;
  if (value.includes(company.code)) score += 12;
  if (IR_PATTERN.test(`${row.title} ${row.snippet} ${row.url}`)) score += 24;
  if (/会社情報|corporate|about/i.test(`${row.title} ${row.url}`)) score += 5;
  if (/\.pdf(?:$|[?#])/i.test(row.url) || DISTRIBUTION_HOST.test(row.url)) score += 10;
  if (NEGATIVE_PATTERN.test(`${row.title} ${row.snippet}`)) score -= 30;
  return score;
}

function parseLinks(html, baseUrl) {
  const rows = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml(match[1]).trim();
    if (!href || /^(?:javascript:|mailto:|tel:|#)/i.test(href)) continue;
    try {
      rows.push({
        url: new URL(href, baseUrl).href,
        text: decodeHtml(stripTags(match[2])).slice(0, 260),
      });
    } catch {}
  }
  return uniqueByUrl(rows);
}

function extractDate(value) {
  const text = String(value || '').normalize('NFKC');
  const match = text.match(/(20\d{2})[年./_-](\d{1,2})[月./_-](\d{1,2})日?/);
  if (!match) return null;
  const date = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  return /^20\d{2}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function documentScore(row) {
  const value = `${row.text || ''} ${row.url || ''}`;
  let score = 0;
  if (/2026|令和8/i.test(value)) score += 35;
  else if (/2025|令和7/i.test(value)) score += 22;
  else if (/2024|令和6/i.test(value)) score += 8;
  if (/中期|経営計画|medium.?term|strategy|vision/i.test(value)) score += 36;
  if (/決算説明|financial results|earnings presentation|presentation/i.test(value)) score += 30;
  if (/統合報告|integrated report/i.test(value)) score += 18;
  if (/決算短信|financial statements/i.test(value)) score += 12;
  if (/\.pdf(?:$|[?#])/i.test(row.url) || DISTRIBUTION_HOST.test(row.url)) score += 14;
  if (NEGATIVE_PATTERN.test(value)) score -= 45;
  return score;
}

function pageMatchesCompany(company, page, searchRow) {
  const haystack = normalizeText(`${page.title} ${page.text.slice(0, 180_000)} ${searchRow?.title || ''} ${searchRow?.snippet || ''}`);
  const variants = nameVariants(company);
  return variants.some(name => haystack.includes(name)) || haystack.includes(company.code);
}

async function inspectCandidate(company, searchRow) {
  const start = await fetchPage(searchRow.url);
  if (start.type === 'pdf') {
    if (!DISTRIBUTION_HOST.test(start.finalUrl) && searchResultScore(company, searchRow) < 55) return null;
    return {
      officialIrUrl: searchRow.url,
      officialHost: normalizeHost(searchRow.url),
      documentUrl: start.finalUrl,
      documentTitle: searchRow.title || '公式IR資料',
      planPublishedDate: extractDate(`${searchRow.title} ${searchRow.snippet} ${start.finalUrl}`),
      sourceStrength: 60 + documentScore({ url: start.finalUrl, text: searchRow.title }),
      evidence: [`検索結果: ${searchRow.title}`, `PDF応答確認: ${start.finalUrl}`],
    };
  }
  if (!pageMatchesCompany(company, start, searchRow)) return null;
  if (isExcluded(start.finalUrl)) return null;

  const officialHost = normalizeHost(start.finalUrl);
  const visited = new Set();
  const pageQueue = [{ ...start, requestedUrl: searchRow.url }];
  const pages = [];
  const documentRows = [];

  while (pageQueue.length && visited.size < MAX_INTERNAL_PAGES) {
    const page = pageQueue.shift();
    if (visited.has(page.finalUrl)) continue;
    visited.add(page.finalUrl);
    const links = parseLinks(page.text, page.finalUrl);
    pages.push({ url: page.finalUrl, title: page.title, linkCount: links.length });
    for (const link of links) {
      const value = `${link.text} ${link.url}`;
      if (/\.pdf(?:$|[?#])/i.test(link.url) || DISTRIBUTION_HOST.test(link.url)) {
        if (DOCUMENT_PATTERN.test(value) || documentScore(link) >= 25) documentRows.push(link);
        continue;
      }
      if (sameSite(link.url, page.finalUrl) && IR_PATTERN.test(value) && !visited.has(link.url) && pageQueue.length < 8) {
        try {
          const child = await fetchPage(link.url);
          if (child.type === 'html' && pageMatchesCompany(company, child, searchRow)) pageQueue.push({ ...child, requestedUrl: link.url });
        } catch {}
      }
    }
  }

  const rankedDocuments = uniqueByUrl(documentRows)
    .map(row => ({ ...row, score: documentScore(row) }))
    .filter(row => row.score >= 18)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));

  let verifiedDocument = null;
  for (const row of rankedDocuments.slice(0, 5)) {
    try {
      const fetched = await fetchPage(row.url, 18_000);
      if (fetched.type === 'pdf') {
        verifiedDocument = { ...row, finalUrl: fetched.finalUrl, bytes: fetched.bytes };
        break;
      }
    } catch {}
  }

  const irPage = pages.find(page => IR_PATTERN.test(`${page.title} ${page.url}`)) || pages[0];
  const hasIrContext = IR_PATTERN.test(`${irPage?.title || ''} ${irPage?.url || ''} ${start.text.slice(0, 250_000)}`);
  if (!hasIrContext && !verifiedDocument) return null;

  const documentUrl = verifiedDocument?.finalUrl || irPage.url;
  const documentTitle = verifiedDocument?.text || irPage.title || searchRow.title || '公式IRページ';
  return {
    officialIrUrl: irPage.url,
    officialHost,
    documentUrl,
    documentTitle: documentTitle.slice(0, 240),
    planPublishedDate: extractDate(`${documentTitle} ${documentUrl} ${start.text.slice(0, 120_000)}`),
    sourceStrength: 45 + (hasIrContext ? 20 : 0) + (verifiedDocument ? verifiedDocument.score + 20 : 0),
    evidence: [
      `公式サイト応答確認: ${start.finalUrl}`,
      verifiedDocument ? `公式サイトからPDFリンク確認: ${verifiedDocument.finalUrl}` : `公式IRページ確認: ${irPage.url}`,
    ],
    pages,
    rankedDocuments: rankedDocuments.slice(0, 8),
  };
}

async function processCompany(company) {
  const known = (KNOWN_START_URLS[company.code] || []).map(url => ({
    url,
    title: `${company.name} IR`,
    snippet: '既知の公式IR URL',
    provider: 'known-map',
  }));
  let searchRows = known;
  if (!searchRows.length) {
    const queryRows = await searchWeb(`"${company.name}" IR 投資家情報 公式`);
    searchRows = queryRows;
    if (searchRows.length < 3) {
      const fallback = await searchWeb(`"${company.name}" 決算説明資料 PDF`);
      searchRows = [...searchRows, ...fallback];
    }
  }

  const ranked = uniqueByUrl(searchRows)
    .map(row => ({ ...row, score: searchResultScore(company, row) }))
    .filter(row => row.score >= 18)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, MAX_RESULT_CANDIDATES);

  const attempts = [];
  for (const row of ranked) {
    try {
      const result = await inspectCandidate(company, row);
      attempts.push({ url: row.url, score: row.score, ok: Boolean(result) });
      if (result) {
        return {
          ...company,
          status: 'verified',
          searchProvider: row.provider,
          searchResult: { url: row.url, title: row.title, snippet: row.snippet, score: row.score },
          ...result,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({ url: row.url, score: row.score, ok: false, error: String(error).slice(0, 240) });
    }
  }
  return { ...company, status: 'unverified', attempts, rankedSearchResults: ranked };
}

const results = new Array(queue.selected.length);
let cursor = 0;
const worker = async () => {
  while (true) {
    const index = cursor++;
    if (index >= queue.selected.length) return;
    results[index] = await processCompany(queue.selected[index]);
    console.log(`${index + 1}/${queue.selected.length} ${queue.selected[index].code} ${results[index].status}`);
    await sleep(200);
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.selected.length) }, () => worker()));

const verified = results
  .filter(row => row.status === 'verified')
  .sort((a, b) => b.sourceStrength - a.sourceStrength || b.score - a.score || a.code.localeCompare(b.code));
const report = {
  version: 'source-coverage-50-discovery-v2',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: queue.sourceBundleSha256,
  targetSourceConfirmed: queue.targetSourceConfirmed,
  needed: queue.needed,
  candidatePoolSize: queue.selected.length,
  verifiedCount: verified.length,
  enoughForTarget: verified.length >= queue.needed,
  selectedForApplication: verified.slice(0, queue.needed),
  verified,
  unverified: results.filter(row => row.status !== 'verified'),
};
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  candidatePoolSize: report.candidatePoolSize,
  needed: report.needed,
  verifiedCount: report.verifiedCount,
  enoughForTarget: report.enoughForTarget,
  selectedCodes: report.selectedForApplication.map(row => row.code),
}, null, 2));
if (!report.enoughForTarget) process.exitCode = 2;
