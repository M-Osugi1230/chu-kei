import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const MAX_PAGES_PER_COMPANY = 7;
const MAX_PDFS_PER_COMPANY = 3;
const MAX_PDF_BYTES = 35_000_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Chu-kei official IR audit/5.1)';
const COMMON_IR_HOSTS = new Set(['contents.xj-storage.jp', 'ssl4.eir-parts.net', 'pdf.irpocket.com']);
const INTERNAL_PATTERN = /ir|investor|financial|library|result|report|presentation|document|material|settlement|earnings|決算|説明|資料|経営|統合報告|有価証券/i;
const POSITIVE_PATTERN = /中期|長期|経営計画|成長可能性|決算説明|統合報告|financial|presentation|strategy|plan|vision|売上高|売上収益|営業収益|ARR|営業利益|EBITDA|ROE|ROIC|設備投資|成長投資|研究開発|M&A|配当|DOE|2026|2027|2028|2029|2030/gi;
const NEGATIVE_PATTERN = /招集通知|株主総会|定款|大量保有|月次売上|人事異動|自己株式の取得状況/gi;
const EVIDENCE_PATTERN = /売上高|売上収益|営業収益|ARR|営業利益|経常利益|EBITDA|ROE|ROIC|設備投資|成長投資|研究開発|M&A|配当性向|DOE|自己株式|202[6-9]|2030/gi;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decodeEntities = value => value
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
const stripTags = value => decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const normalizedHost = url => new URL(url).hostname.toLowerCase().replace(/^www\./, '');
const isOfficialHost = (url, startHost) => {
  const host = normalizedHost(url);
  return host === startHost || host.endsWith(`.${startHost}`) || COMMON_IR_HOSTS.has(host);
};
const extractLinks = (html, baseUrl) => {
  const links = [];
  const pattern = /<a\b[^>]*?href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeEntities(match[1] || match[2] || match[3] || '').trim();
    if (!raw || raw.startsWith('#') || /^(?:javascript|mailto|tel):/i.test(raw)) continue;
    try {
      links.push({ url: new URL(raw, baseUrl).href, text: stripTags(match[4] || '') });
    } catch {}
  }
  return links;
};
const scoreLink = ({ url, text }) => {
  const combined = `${text} ${url}`;
  const positive = combined.match(POSITIVE_PATTERN)?.length || 0;
  const negative = combined.match(NEGATIVE_PATTERN)?.length || 0;
  let score = positive * 6 - negative * 20;
  if (/中期|経営計画|成長可能性|strategy|plan|vision/i.test(combined)) score += 30;
  if (/決算説明|presentation|統合報告/i.test(combined)) score += 20;
  if (/2026|2027|2028|2029|2030/.test(combined)) score += 12;
  if (/\.pdf(?:$|[?#])/i.test(url)) score += 5;
  return score;
};
const fetchText = async url => {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'ja,en;q=0.7' }, redirect: 'follow', signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (/pdf/i.test(contentType)) return { finalUrl: response.url, contentType, html: '', pdfBuffer: Buffer.from(await response.arrayBuffer()) };
  return { finalUrl: response.url, contentType, html: await response.text(), pdfBuffer: null };
};
const pdfToEvidence = async candidate => {
  const response = await fetch(candidate.url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PDF_BYTES) throw new Error(`PDF exceeds ${MAX_PDF_BYTES} bytes`);
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('not a PDF');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chukei-final10-'));
  const input = path.join(tempDir, 'document.pdf');
  try {
    fs.writeFileSync(input, buffer);
    const text = execFileSync('pdftotext', ['-layout', '-f', '1', '-l', '140', input, '-'], { encoding: 'utf8', maxBuffer: 25 * 1024 * 1024, timeout: 90_000 });
    const pages = text.split('\f');
    const evidencePages = [];
    let metricHits = 0;
    for (let index = 0; index < pages.length; index += 1) {
      const normalized = pages[index].replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      const hits = normalized.match(EVIDENCE_PATTERN)?.length || 0;
      if (!hits) continue;
      metricHits += hits;
      evidencePages.push({ page: index + 1, hits, snippet: normalized.slice(0, 1800) });
    }
    return {
      url: response.url,
      anchorText: candidate.text,
      linkScore: candidate.score,
      evidenceScore: candidate.score + Math.min(metricHits, 240) + evidencePages.length * 3,
      bytes: buffer.length,
      pageCountApprox: pages.length,
      metricHits,
      evidencePages: evidencePages.sort((a, b) => b.hits - a.hits || a.page - b.page).slice(0, 16),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const companies = payload.companies
  .filter(company => company.stage === 'source_indexed')
  .map(company => ({ code: String(company.code), name: company.name, startUrl: company.sourceUrl }));
if (companies.length !== 10) throw new Error(`Expected 10 source-indexed companies, got ${companies.length}`);

const report = {};
let pdftotextAvailable = true;
try {
  execFileSync('pdftotext', ['-v'], { stdio: 'ignore', timeout: 10_000 });
} catch {
  pdftotextAvailable = false;
}

for (const company of companies) {
  const startHost = normalizedHost(company.startUrl);
  const queue = [company.startUrl];
  const visited = new Set();
  const pdfCandidates = new Map();
  const pageErrors = [];

  while (queue.length && visited.size < MAX_PAGES_PER_COMPANY) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const fetched = await fetchText(url);
      if (fetched.pdfBuffer) {
        const candidate = { url: fetched.finalUrl, text: '', score: scoreLink({ url: fetched.finalUrl, text: '' }) };
        pdfCandidates.set(candidate.url, candidate);
        continue;
      }
      for (const link of extractLinks(fetched.html, fetched.finalUrl)) {
        if (!isOfficialHost(link.url, startHost)) continue;
        if (/\.pdf(?:$|[?#])/i.test(link.url)) {
          const candidate = { ...link, score: scoreLink(link) };
          const previous = pdfCandidates.get(candidate.url);
          if (!previous || candidate.score > previous.score) pdfCandidates.set(candidate.url, candidate);
        } else if (INTERNAL_PATTERN.test(`${link.text} ${link.url}`) && !visited.has(link.url) && queue.length < 30) {
          queue.push(link.url);
        }
      }
    } catch (error) {
      pageErrors.push({ url, error: String(error) });
    }
    await sleep(150);
  }

  const ranked = [...pdfCandidates.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)).slice(0, MAX_PDFS_PER_COMPANY);
  const documents = [];
  if (pdftotextAvailable) {
    for (const candidate of ranked) {
      try {
        documents.push(await pdfToEvidence(candidate));
      } catch (error) {
        documents.push({ url: candidate.url, anchorText: candidate.text, linkScore: candidate.score, error: String(error) });
      }
    }
  }
  documents.sort((a, b) => (b.evidenceScore ?? -1) - (a.evidenceScore ?? -1) || (b.linkScore ?? -1) - (a.linkScore ?? -1));
  report[company.code] = {
    name: company.name,
    startUrl: company.startUrl,
    visitedPages: [...visited],
    pageErrors,
    discoveredPdfCount: pdfCandidates.size,
    pdftotextAvailable,
    documents,
  };
}

const output = {
  version: 'final10-static-official-research-v1',
  generatedAt: new Date().toISOString(),
  companies: report,
};
const outputPath = path.join(ROOT, 'artifacts', 'final10-static-official-research-v1.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
const qualityReportPath = path.join(ROOT, 'artifacts', 'quality-report-v43.json');
if (fs.existsSync(qualityReportPath)) {
  const qualityReport = JSON.parse(fs.readFileSync(qualityReportPath, 'utf8'));
  qualityReport.final10OfficialResearch = output;
  fs.writeFileSync(qualityReportPath, `${JSON.stringify(qualityReport, null, 2)}\n`);
}
console.log(JSON.stringify({ companies: companies.length, pdftotextAvailable, documents: Object.values(report).reduce((sum, item) => sum + item.documents.length, 0) }, null, 2));
