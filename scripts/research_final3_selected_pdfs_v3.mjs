import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const QUALITY_PATH = path.join(ROOT, 'artifacts', 'quality-report-v43.json');
const MAX_PDF_BYTES = 40_000_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Chu-kei official IR audit/5.7)';
const EVIDENCE_PATTERN = /売上高|売上収益|営業収益|revenue|ARR|営業利益|経常利益|operating profit|EBITDA|ROE|ROIC|設備投資|capital expenditures|成長投資|研究開発|R&D|M&A|配当|dividend|DOE|自己株式|202[6-9]|2030/gi;

const TARGETS = {
  '5574': {
    name: 'ABEJA',
    startUrl: 'https://www.abejainc.com/ir-presentation',
    candidates: [
      { url: 'https://ssl4.eir-parts.net/doc/5574/ir_material_for_fiscal_ym/201892/00.pdf', label: '最新決算説明資料' },
      { url: 'https://ssl4.eir-parts.net/doc/5574/tdnet/2846955/00.pdf', label: '最新適時開示資料' },
    ],
  },
  '6723': {
    name: 'ルネサスエレクトロニクス',
    startUrl: 'https://www.renesas.com/ja/about/investor-relations/event/presentation',
    candidates: [
      { url: 'https://www.renesas.com/document/ppt/2026-1q-presentation-material', label: '2026年12月期第1四半期決算説明資料' },
      { url: 'https://www.renesas.com/document/ppt/finance-2026-capital-market-day', label: '2026 Capital Market Day Finance' },
    ],
  },
  '8198': {
    name: 'マックスバリュ東海',
    startUrl: 'https://www.mv-tokai.co.jp/ir/data/material/',
    candidates: [
      { url: 'https://ssl4.eir-parts.net/doc/8198/ir_material_for_fiscal_ym2/205895/00.pdf', label: '最新決算説明資料' },
      { url: 'https://ssl4.eir-parts.net/doc/8198/tdnet/2849879/00.pdf', label: '2027年2月期第1四半期決算短信' },
    ],
  },
};

const loadPdfParse = () => {
  try {
    return require('pdf-parse');
  } catch {
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', 'pdf-parse@1.1.1'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 120_000,
    });
    return require('pdf-parse');
  }
};

const renderPdfPage = async pageData => {
  const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  let lastY;
  let text = '';
  for (const item of content.items) {
    const y = item.transform?.[5];
    text += lastY === undefined || y === lastY ? item.str : `\n${item.str}`;
    lastY = y;
  }
  return `\f${text}`;
};

const pdfParse = loadPdfParse();
const parsePdf = async candidate => {
  const response = await fetch(candidate.url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PDF_BYTES) throw new Error(`PDF exceeds ${MAX_PDF_BYTES} bytes`);
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`not a PDF: ${response.headers.get('content-type') || 'unknown'}`);
  const parsed = await pdfParse(buffer, { pagerender: renderPdfPage, max: 180 });
  const pages = parsed.text.split('\f').filter(Boolean);
  const evidencePages = [];
  let metricHits = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const normalized = pages[index].replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const hits = normalized.match(EVIDENCE_PATTERN)?.length || 0;
    if (!hits) continue;
    metricHits += hits;
    evidencePages.push({ page: index + 1, hits, snippet: normalized.slice(0, 2600) });
  }
  return {
    url: response.url,
    requestedUrl: candidate.url,
    anchorText: candidate.label,
    evidenceScore: Math.min(metricHits, 300) + evidencePages.length * 4,
    bytes: buffer.length,
    pageCount: parsed.numpages,
    metricHits,
    metadata: parsed.info || {},
    firstPages: pages.slice(0, 4).map((page, index) => ({ page: index + 1, text: page.replace(/\s+/g, ' ').trim().slice(0, 3000) })),
    evidencePages: evidencePages.sort((a, b) => b.hits - a.hits || a.page - b.page).slice(0, 28),
  };
};

if (!fs.existsSync(QUALITY_PATH)) throw new Error('quality report missing');
const quality = JSON.parse(fs.readFileSync(QUALITY_PATH, 'utf8'));
quality.final10OfficialResearch ??= { version: 'final10-merged-official-research-v1', companies: {} };
const report = {};

for (const [code, target] of Object.entries(TARGETS)) {
  const documents = await Promise.all(target.candidates.map(async candidate => {
    try {
      return await parsePdf(candidate);
    } catch (error) {
      return { url: candidate.url, requestedUrl: candidate.url, anchorText: candidate.label, error: String(error) };
    }
  }));
  documents.sort((a, b) => (b.evidenceScore ?? -1) - (a.evidenceScore ?? -1));
  quality.final10OfficialResearch.companies[code] = {
    ...(quality.final10OfficialResearch.companies[code] || {}),
    name: target.name,
    startUrl: target.startUrl,
    selectedDirectResearch: true,
    documents,
  };
  report[code] = { name: target.name, startUrl: target.startUrl, documents };
}

quality.final3SelectedOfficialResearch = {
  version: 'final3-selected-official-research-v3',
  generatedAt: new Date().toISOString(),
  companies: report,
};
fs.writeFileSync(QUALITY_PATH, `${JSON.stringify(quality, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, 'artifacts', 'final3-selected-official-research-v3.json'), `${JSON.stringify(quality.final3SelectedOfficialResearch, null, 2)}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([code, row]) => [code, {
  documents: row.documents.length,
  successful: row.documents.filter(document => !document.error).length,
  errors: row.documents.filter(document => document.error).map(document => ({ url: document.url, error: document.error })),
}])), null, 2));
