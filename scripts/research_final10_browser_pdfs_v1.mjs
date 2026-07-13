import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const LINKS_PATH = path.join(ROOT, 'artifacts', 'final10-browser-links-v1.json');
const QUALITY_PATH = path.join(ROOT, 'artifacts', 'quality-report-v43.json');
const COMMON_IR_HOSTS = new Set(['contents.xj-storage.jp', 'ssl4.eir-parts.net', 'pdf.irpocket.com']);
const POSITIVE_PATTERN = /中期|長期|経営計画|成長可能性|決算説明|統合報告|financial|presentation|strategy|plan|vision|売上高|売上収益|営業収益|ARR|営業利益|EBITDA|ROE|ROIC|設備投資|成長投資|研究開発|M&A|配当|DOE|2026|2027|2028|2029|2030/gi;
const NEGATIVE_PATTERN = /招集通知|株主総会|定款|大量保有|月次売上|人事異動|自己株式の取得状況/gi;
const EVIDENCE_PATTERN = /売上高|売上収益|営業収益|ARR|営業利益|経常利益|EBITDA|ROE|ROIC|設備投資|成長投資|研究開発|M&A|配当性向|DOE|自己株式|202[6-9]|2030/gi;
const MAX_PDF_BYTES = 35_000_000;
const MAX_PDFS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; Chu-kei official IR audit/5.3)';

const normalizeHost = value => new URL(value).hostname.toLowerCase().replace(/^www\./, '');
const isOfficialHost = (url, startHost) => {
  const host = normalizeHost(url);
  return host === startHost || host.endsWith(`.${startHost}`) || COMMON_IR_HOSTS.has(host);
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
const renderPdfPage = async pageData => {
  const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  let lastY;
  let text = '';
  for (const item of content.items) {
    const y = item.transform?.[5];
    if (lastY === undefined || y === lastY) text += item.str;
    else text += `\n${item.str}`;
    lastY = y;
  }
  return `\f${text}`;
};
const pdfParse = require('pdf-parse');
const parsePdf = async candidate => {
  const response = await fetch(candidate.url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PDF_BYTES) throw new Error(`PDF exceeds ${MAX_PDF_BYTES} bytes`);
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('not a PDF');
  const parsed = await pdfParse(buffer, { pagerender: renderPdfPage, max: 140 });
  const pages = parsed.text.split('\f').filter(Boolean);
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
    pageCount: parsed.numpages,
    metricHits,
    evidencePages: evidencePages.sort((a, b) => b.hits - a.hits || a.page - b.page).slice(0, 16),
    metadata: parsed.info || {},
  };
};

if (!fs.existsSync(LINKS_PATH) || !fs.existsSync(QUALITY_PATH)) {
  console.log('Browser links or quality report missing; browser PDF merge skipped.');
  process.exit(0);
}
const browserLinks = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
const quality = JSON.parse(fs.readFileSync(QUALITY_PATH, 'utf8'));
quality.final10OfficialResearch ??= { version: 'final10-merged-official-research-v1', companies: {} };
const browserReport = {};

for (const [code, company] of Object.entries(browserLinks.companies || {})) {
  const startHost = normalizeHost(company.startUrl);
  const candidates = new Map();
  for (const page of company.pages || []) {
    for (const link of page.links || []) {
      if (!/\.pdf(?:$|[?#])/i.test(link.url)) continue;
      try {
        if (!isOfficialHost(link.url, startHost)) continue;
      } catch {
        continue;
      }
      const candidate = { url: link.url, text: link.text || '', score: scoreLink({ url: link.url, text: link.text || '' }) };
      const previous = candidates.get(candidate.url);
      if (!previous || candidate.score > previous.score) candidates.set(candidate.url, candidate);
    }
    for (const response of page.responses || []) {
      if (!/\.pdf(?:$|[?#])/i.test(response.url) && !/pdf/i.test(response.contentType || '')) continue;
      try {
        if (!isOfficialHost(response.url, startHost)) continue;
      } catch {
        continue;
      }
      const candidate = { url: response.url, text: 'network response', score: scoreLink({ url: response.url, text: '' }) };
      candidates.set(candidate.url, candidates.get(candidate.url) || candidate);
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)).slice(0, MAX_PDFS);
  const documents = [];
  for (const candidate of ranked) {
    try {
      documents.push(await parsePdf(candidate));
    } catch (error) {
      documents.push({ url: candidate.url, anchorText: candidate.text, linkScore: candidate.score, error: String(error) });
    }
  }
  const existingCompany = quality.final10OfficialResearch.companies[code] || { name: company.name, startUrl: company.startUrl, documents: [] };
  const mergedByUrl = new Map();
  for (const document of [...(existingCompany.documents || []), ...documents]) {
    const previous = mergedByUrl.get(document.url);
    if (!previous || (document.evidenceScore ?? -1) > (previous.evidenceScore ?? -1)) mergedByUrl.set(document.url, document);
  }
  const mergedDocuments = [...mergedByUrl.values()].sort((a, b) => (b.evidenceScore ?? -1) - (a.evidenceScore ?? -1) || (b.linkScore ?? -1) - (a.linkScore ?? -1));
  quality.final10OfficialResearch.companies[code] = {
    ...existingCompany,
    name: company.name,
    startUrl: company.startUrl,
    browserVisitedPages: (company.pages || []).map(page => page.url),
    browserPageErrors: (company.pages || []).filter(page => page.error).map(page => ({ url: page.url, error: page.error })),
    browserDiscoveredPdfCount: candidates.size,
    documents: mergedDocuments,
  };
  browserReport[code] = { name: company.name, startUrl: company.startUrl, discoveredPdfCount: candidates.size, documents };
}

fs.writeFileSync(QUALITY_PATH, `${JSON.stringify(quality, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, 'artifacts', 'final10-browser-official-research-v1.json'), `${JSON.stringify({ version: 'final10-browser-official-research-v1', companies: browserReport }, null, 2)}\n`);
console.log(JSON.stringify({ companies: Object.keys(browserReport).length, documents: Object.values(browserReport).reduce((sum, row) => sum + row.documents.length, 0) }, null, 2));
