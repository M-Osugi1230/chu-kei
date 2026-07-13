import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const QUEUE_PATH = path.join(ROOT, 'operations', 'research', 'source-coverage-50-queue.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research', 'source-coverage-50-discovery.json');
const CONCURRENCY = Number(process.env.SOURCE_DISCOVERY_CONCURRENCY || 6);
const TIMEOUT_MS = 18_000;
const MAX_INTERNAL_PAGES = 5;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36';

const KNOWN_START_URLS = {
  '3635': ['https://www.koeitecmo.co.jp/ir/'], '3661': ['https://m-upholdings.co.jp/ir/'],
  '3962': ['https://www.changeholdings.co.jp/ir/'], '2127': ['https://www.nihon-ma.co.jp/groups/ir/'],
  '2146': ['https://www.ut-g.co.jp/ir/'], '2153': ['https://www.ej-hds.co.jp/ir/'],
  '4004': ['https://www.resonac.com/jp/corporate/ir'], '3231': ['https://www.nomura-re-hd.co.jp/ir/'],
  '3288': ['https://openhouse-group.co.jp/ir/'], '3289': ['https://www.tokyu-fudosan-hd.co.jp/ir/'],
  '2784': ['https://www.alfresa.com/ir/'], '3107': ['https://www.daiwabo-holdings.com/ja/ir/'],
  '3132': ['https://www.macnica.co.jp/company/ir/'], '1414': ['https://www.sho-bondhd.jp/ir/'],
  '1721': ['https://www.comsys-hd.co.jp/ir/'], '2321': ['https://www.softfront.co.jp/ir/'],
  '3300': ['https://www.am-bition.jp/ir/'], '3070': ['https://www.jelly-beans-group.co.jp/ir/'],
  '9326': ['https://www.kantsu-hd.co.jp/ir/'], '4011': ['https://www.headwaters.co.jp/ir/'],
  '4651': ['https://sanix-hd.co.jp/ir/'], '6035': ['https://www.irjapan-hd.com/ir/'],
  '6082': ['https://www.rideonexpresshd.co.jp/ir/'], '3113': ['https://univa-oak.com/ir/'],
  '4994': ['https://www.taiseilamick.co.jp/ir/', 'https://www.lamick.co.jp/ir/'],
};

const EXCLUDED_HOST = /(?:^|\.)(?:jpx\.co\.jp|www2\.jpx\.co\.jp|google\.|bing\.com|duckduckgo\.com|yahoo\.co\.jp|nikkei\.com|kabutan\.jp|minkabu\.jp|irbank\.net|buffett-code\.com|ullet\.com|wikipedia\.org|prtimes\.jp|x\.com|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|maps\.google\.|goo\.gl)$/i;
const DISTRIBUTION_HOST = /xj-storage|eir-parts|irpocket|tdnet|svss\.tv/i;
const IR_PATTERN = /(?:^|[\/_-])ir(?:[\/_-]|$)|investor|financial|finance|library|result|report|presentation|document|material|settlement|earnings|決算|説明資料|経営計画|中期|統合報告|投資家/i;
const DOCUMENT_PATTERN = /中期|経営計画|medium.?term|strategy|vision|決算説明|financial results|earnings presentation|presentation|統合報告|integrated report|決算短信|financial statements/i;
const NEGATIVE_PATTERN = /招集通知|株主総会|定款|大量保有|自己株式の取得状況|月次|人事異動|コーポレート・ガバナンス報告書/i;
const OFFICIAL_LINK_PATTERN = /会社.*(?:ホームページ|ウェブサイト|web.?site)|企業.*(?:ホームページ|ウェブサイト)|公式.*(?:サイト|ホームページ)|homepage|website/i;

const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decodeHtml = value => String(value || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
const stripTags = value => String(value || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const normalizeHost = value => { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const sameSite = (a, b) => {
  const x = normalizeHost(a); const y = normalizeHost(b);
  return x && y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`));
};
const uniqueByUrl = rows => [...new Map(rows.filter(row => row.url).map(row => [row.url, row])).values()];
const isExcluded = url => { const host = normalizeHost(url); return !host || EXCLUDED_HOST.test(host); };

async function fetchResponse(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow', signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'ja,en-US;q=0.8', accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
    });
  } finally { clearTimeout(timer); }
}

async function fetchPage(url) {
  const response = await fetchResponse(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const finalUrl = response.url || url;
  const contentType = response.headers.get('content-type') || '';
  if (/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(finalUrl)) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') throw new Error('PDF signature missing');
    return { type: 'pdf', finalUrl, bytes: bytes.length, title: '', text: '' };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  let text = buffer.toString('utf8');
  if ((text.match(/�/g) || []).length > 20) text = new TextDecoder('shift_jis').decode(buffer);
  return {
    type: 'html', finalUrl, text: text.slice(0, 2_000_000),
    title: decodeHtml(stripTags((text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')),
  };
}

function parseLinks(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtml(match[1]).trim();
    if (!href || /^(?:javascript:|mailto:|tel:|#)/i.test(href)) continue;
    try { links.push({ url: new URL(href, baseUrl).href, text: decodeHtml(stripTags(match[2])).slice(0, 260) }); } catch {}
  }
  return uniqueByUrl(links);
}

function extractDate(value) {
  const match = String(value || '').normalize('NFKC').match(/(20\d{2})[年./_-](\d{1,2})[月./_-](\d{1,2})日?/);
  return match ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` : null;
}

function documentScore(link) {
  const value = `${link.text || ''} ${link.url || ''}`;
  let score = 0;
  if (/2026|令和8/i.test(value)) score += 30; else if (/2025|令和7/i.test(value)) score += 20;
  if (/中期|経営計画|medium.?term|strategy|vision/i.test(value)) score += 36;
  if (/決算説明|financial results|earnings presentation|presentation/i.test(value)) score += 28;
  if (/統合報告|integrated report/i.test(value)) score += 18;
  if (/決算短信|financial statements/i.test(value)) score += 10;
  if (/\.pdf(?:$|[?#])/i.test(link.url) || DISTRIBUTION_HOST.test(link.url)) score += 14;
  if (NEGATIVE_PATTERN.test(value)) score -= 45;
  return score;
}

async function jpxOfficialCandidates(company) {
  if (!company.jpxUrl) return [];
  try {
    const page = await fetchPage(company.jpxUrl);
    if (page.type !== 'html') return [];
    return parseLinks(page.text, page.finalUrl)
      .filter(link => /^https?:/i.test(link.url) && !sameSite(link.url, page.finalUrl) && !isExcluded(link.url))
      .map(link => {
        let score = 20;
        if (OFFICIAL_LINK_PATTERN.test(`${link.text} ${link.url}`)) score += 70;
        if (/会社情報|corporate|about/i.test(`${link.text} ${link.url}`)) score += 15;
        if (IR_PATTERN.test(`${link.text} ${link.url}`)) score += 25;
        if (/\.pdf(?:$|[?#])/i.test(link.url)) score -= 10;
        return { ...link, score, provider: 'jpx-listed-link' };
      })
      .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
      .slice(0, 8);
  } catch (error) {
    return [{ url: '', text: '', score: -1, provider: 'jpx-error', error: String(error).slice(0, 240) }];
  }
}

async function inspectSite(company, candidate) {
  const start = await fetchPage(candidate.url);
  if (start.type === 'pdf') {
    if (!DISTRIBUTION_HOST.test(start.finalUrl) && candidate.provider !== 'known-map') return null;
    return {
      officialIrUrl: candidate.url, officialHost: normalizeHost(candidate.url), documentUrl: start.finalUrl,
      documentTitle: candidate.text || '公式IR資料', planPublishedDate: extractDate(`${candidate.text} ${candidate.url}`),
      sourceStrength: 100 + documentScore(candidate),
      evidence: [`JPXまたは既知公式導線: ${company.jpxUrl || candidate.url}`, `PDF応答確認: ${start.finalUrl}`],
    };
  }
  if (isExcluded(start.finalUrl)) return null;

  const rootUrl = start.finalUrl;
  const queuePages = [start];
  const visited = new Set();
  const pages = [];
  const documents = [];
  const irCandidates = [];
  while (queuePages.length && visited.size < MAX_INTERNAL_PAGES) {
    const page = queuePages.shift();
    if (visited.has(page.finalUrl)) continue;
    visited.add(page.finalUrl);
    const links = parseLinks(page.text, page.finalUrl);
    const pageIr = IR_PATTERN.test(`${page.title} ${page.finalUrl} ${stripTags(page.text.slice(0, 250_000))}`);
    pages.push({ url: page.finalUrl, title: page.title, linkCount: links.length, irContext: pageIr });
    if (pageIr) irCandidates.push({ url: page.finalUrl, title: page.title, score: 60 });
    for (const link of links) {
      const value = `${link.text} ${link.url}`;
      if (/\.pdf(?:$|[?#])/i.test(link.url) || DISTRIBUTION_HOST.test(link.url)) {
        const score = documentScore(link);
        if (score >= 15) documents.push({ ...link, score });
        continue;
      }
      if (sameSite(link.url, rootUrl) && IR_PATTERN.test(value)) {
        irCandidates.push({ url: link.url, title: link.text, score: 80 + (DOCUMENT_PATTERN.test(value) ? 20 : 0) });
        if (!visited.has(link.url) && queuePages.length < 12) {
          try { const child = await fetchPage(link.url); if (child.type === 'html') queuePages.push(child); } catch {}
        }
      }
    }
  }

  const rankedIr = uniqueByUrl(irCandidates).sort((a, b) => b.score - a.score);
  const rankedDocs = uniqueByUrl(documents).sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  if (!rankedIr.length && !rankedDocs.length) return null;

  let verifiedDocument = null;
  for (const document of rankedDocs.slice(0, 5)) {
    try { const result = await fetchPage(document.url); if (result.type === 'pdf') { verifiedDocument = { ...document, finalUrl: result.finalUrl }; break; } } catch {}
  }
  const irPage = rankedIr[0] || { url: rootUrl, title: start.title };
  const documentUrl = verifiedDocument?.finalUrl || irPage.url;
  const documentTitle = verifiedDocument?.text || irPage.title || '公式IRページ';
  return {
    officialIrUrl: irPage.url, officialHost: normalizeHost(rootUrl), documentUrl,
    documentTitle: String(documentTitle).slice(0, 240),
    planPublishedDate: extractDate(`${documentTitle} ${documentUrl}`),
    sourceStrength: (candidate.provider === 'jpx-listed-link' ? 100 : 80) + (rankedIr.length ? 30 : 0) + (verifiedDocument ? 30 + verifiedDocument.score : 0),
    evidence: [
      `JPX銘柄ページ掲載の企業サイト導線: ${company.jpxUrl || candidate.url}`,
      verifiedDocument ? `公式サイトからIR資料PDF応答確認: ${verifiedDocument.finalUrl}` : `公式IRページ応答確認: ${irPage.url}`,
    ],
    pages,
    rankedDocuments: rankedDocs.slice(0, 8),
  };
}

async function processCompany(company) {
  const known = (KNOWN_START_URLS[company.code] || []).map(url => ({ url, text: `${company.name} IR`, score: 120, provider: 'known-map' }));
  const jpx = await jpxOfficialCandidates(company);
  const candidates = uniqueByUrl([...known, ...jpx])
    .filter(row => row.url && !isExcluded(row.url))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  const attempts = [];
  for (const candidate of candidates) {
    try {
      const result = await inspectSite(company, candidate);
      attempts.push({ url: candidate.url, provider: candidate.provider, score: candidate.score, ok: Boolean(result) });
      if (result) return { ...company, status: 'verified', searchProvider: candidate.provider, searchResult: candidate, ...result, attempts };
    } catch (error) {
      attempts.push({ url: candidate.url, provider: candidate.provider, score: candidate.score, ok: false, error: String(error).slice(0, 240) });
    }
  }
  return { ...company, status: 'unverified', attempts, jpxCandidates: jpx };
}

const results = new Array(queue.selected.length);
let cursor = 0;
const worker = async () => {
  while (true) {
    const index = cursor++;
    if (index >= queue.selected.length) return;
    results[index] = await processCompany(queue.selected[index]);
    console.log(`${index + 1}/${queue.selected.length} ${queue.selected[index].code} ${results[index].status}`);
    await sleep(150);
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.selected.length) }, () => worker()));

const verified = results.filter(row => row.status === 'verified')
  .sort((a, b) => b.sourceStrength - a.sourceStrength || b.score - a.score || a.code.localeCompare(b.code));
const report = {
  version: 'source-coverage-50-discovery-v2', generatedAt: new Date().toISOString(),
  discoveryEngine: 'jpx-official-link-v3', sourceBundleSha256: queue.sourceBundleSha256,
  targetSourceConfirmed: queue.targetSourceConfirmed, needed: queue.needed,
  candidatePoolSize: queue.selected.length, verifiedCount: verified.length,
  enoughForTarget: verified.length >= queue.needed,
  selectedForApplication: verified.slice(0, queue.needed), verified,
  unverified: results.filter(row => row.status !== 'verified'),
};
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ candidatePoolSize: report.candidatePoolSize, needed: report.needed, verifiedCount: report.verifiedCount, enoughForTarget: report.enoughForTarget, selectedCodes: report.selectedForApplication.map(row => row.code) }, null, 2));
if (!report.enoughForTarget) process.exitCode = 2;
