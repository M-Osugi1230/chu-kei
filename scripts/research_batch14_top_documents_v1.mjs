import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const DISCOVERY_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-official-discovery.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-evidence.json');
const MAX_DOCUMENTS_PER_COMPANY = 3;
const MAX_PDF_BYTES = 45_000_000;
const CONCURRENCY = 4;
const USER_AGENT = 'Mozilla/5.0 (compatible; Chu-kei official IR audit/6.0)';
const EVIDENCE_PATTERN = /売上高|売上収益|営業収益|revenue|ARR|受注|営業利益|事業利益|経常利益|operating profit|EBITDA|ROE|ROIC|自己資本|設備投資|capital expenditure|成長投資|研究開発|R&D|M&A|買収|事業ポートフォリオ|配当|dividend|DOE|自己株式|株主還元|202[6-9]|2030/gi;
const STRATEGY_PATTERN = /中期|経営計画|戦略|成長|重点|ポートフォリオ|DX|AI|海外|人材|人的資本|M&A|設備投資|株主還元|ROE|ROIC/gi;

const loadPdfParse = () => {
  try { return require('pdf-parse'); } catch {
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', 'pdf-parse@1.1.1'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 120_000,
    });
    return require('pdf-parse');
  }
};
const pdfParse = loadPdfParse();

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

const isPdfCandidate = row => /\.pdf(?:$|[?#])/i.test(row.url || '') || /xj-storage|eir-parts|irpocket/i.test(row.url || '');
const parseDocument = async (company, candidate) => {
  const response = await fetch(candidate.url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PDF_BYTES) throw new Error(`PDF exceeds ${MAX_PDF_BYTES} bytes`);
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`not a PDF: ${response.headers.get('content-type') || 'unknown'}`);
  const parsed = await pdfParse(buffer, { pagerender: renderPdfPage, max: 180 });
  const pages = parsed.text.split('\f').filter(Boolean);
  const pageRows = [];
  let metricHits = 0;
  let strategyHits = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const text = pages[index].replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const metrics = text.match(EVIDENCE_PATTERN)?.length || 0;
    const strategies = text.match(STRATEGY_PATTERN)?.length || 0;
    if (!metrics && !strategies) continue;
    metricHits += metrics;
    strategyHits += strategies;
    pageRows.push({ page: index + 1, metricHits: metrics, strategyHits: strategies, snippet: text.slice(0, 3000) });
  }
  const firstPages = pages.slice(0, 4).map((page, index) => ({ page: index + 1, text: page.replace(/\s+/g, ' ').trim().slice(0, 3200) }));
  const recentYearHits = `${firstPages.map(row => row.text).join(' ')} ${candidate.text || ''}`.match(/2026|令和8/g)?.length || 0;
  const evidenceScore = Math.min(metricHits, 350) + Math.min(strategyHits, 200) + pageRows.length * 3 + recentYearHits * 10 + (candidate.score || 0);
  return {
    requestedUrl: candidate.url,
    url: response.url,
    anchorText: candidate.text || '',
    sourcePage: candidate.sourcePage || company.officialIrUrl,
    candidateScore: candidate.score || 0,
    evidenceScore,
    bytes: buffer.length,
    pageCount: parsed.numpages,
    metricHits,
    strategyHits,
    recentYearHits,
    metadata: parsed.info || {},
    firstPages,
    evidencePages: pageRows.sort((a, b) => (b.metricHits + b.strategyHits) - (a.metricHits + a.strategyHits) || a.page - b.page).slice(0, 30),
  };
};

const discovery = JSON.parse(fs.readFileSync(DISCOVERY_PATH, 'utf8'));
const targetCodes = discovery.selectedForDetailedResearch.map(row => String(row.code));
if (targetCodes.length !== 15) throw new Error(`Expected 15 detailed research companies, got ${targetCodes.length}`);
const companies = targetCodes.map(code => discovery.companies[code]);
const tasks = [];
for (const company of companies) {
  const candidates = (company.rankedLinks || []).filter(isPdfCandidate).slice(0, MAX_DOCUMENTS_PER_COMPANY);
  for (const candidate of candidates) tasks.push({ company, candidate });
}

let cursor = 0;
const documentsByCode = Object.fromEntries(targetCodes.map(code => [code, []]));
const worker = async () => {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= tasks.length) return;
    const { company, candidate } = tasks[index];
    try {
      documentsByCode[company.code].push(await parseDocument(company, candidate));
    } catch (error) {
      documentsByCode[company.code].push({ requestedUrl: candidate.url, anchorText: candidate.text || '', candidateScore: candidate.score || 0, error: String(error) });
    }
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length || 1) }, () => worker()));

const researched = targetCodes.map(code => {
  const discoveryCompany = discovery.companies[code];
  const documents = documentsByCode[code].sort((a, b) => (b.evidenceScore ?? -1) - (a.evidenceScore ?? -1));
  const successful = documents.filter(document => !document.error);
  const documentStrength = successful.reduce((sum, document) => sum + Math.min(document.evidenceScore || 0, 500), 0);
  const pageEvidenceCount = successful.reduce((sum, document) => sum + (document.evidencePages?.length || 0), 0);
  const recentDocumentCount = successful.filter(document => (document.recentYearHits || 0) > 0).length;
  const readinessScore = discoveryCompany.priorityScore + discoveryCompany.sourceStrength + Math.min(documentStrength / 10, 150) + pageEvidenceCount * 2 + recentDocumentCount * 15;
  return {
    code,
    name: discoveryCompany.name,
    market: discoveryCompany.market,
    industry: discoveryCompany.industry,
    priorityScore: discoveryCompany.priorityScore,
    sourceStrength: discoveryCompany.sourceStrength,
    readinessScore: Number(readinessScore.toFixed(1)),
    officialIrUrl: discoveryCompany.officialIrUrl,
    successfulDocumentCount: successful.length,
    pageEvidenceCount,
    recentDocumentCount,
    documents,
  };
}).sort((a, b) => b.readinessScore - a.readinessScore || a.code.localeCompare(b.code));

const selectedForStructuring = [];
const industryCounts = new Map();
for (const company of researched) {
  if (selectedForStructuring.length >= 10) break;
  if (company.successfulDocumentCount === 0 || company.pageEvidenceCount < 2) continue;
  const count = industryCounts.get(company.industry) || 0;
  if (count >= 3) continue;
  selectedForStructuring.push({
    code: company.code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    readinessScore: company.readinessScore,
    officialIrUrl: company.officialIrUrl,
    successfulDocumentCount: company.successfulDocumentCount,
    pageEvidenceCount: company.pageEvidenceCount,
    recentDocumentCount: company.recentDocumentCount,
    topDocumentUrl: company.documents.find(document => !document.error)?.url || null,
  });
  industryCounts.set(company.industry, count + 1);
}
for (const company of researched) {
  if (selectedForStructuring.length >= 10) break;
  if (selectedForStructuring.some(row => row.code === company.code)) continue;
  if (company.successfulDocumentCount === 0) continue;
  selectedForStructuring.push({
    code: company.code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    readinessScore: company.readinessScore,
    officialIrUrl: company.officialIrUrl,
    successfulDocumentCount: company.successfulDocumentCount,
    pageEvidenceCount: company.pageEvidenceCount,
    recentDocumentCount: company.recentDocumentCount,
    topDocumentUrl: company.documents.find(document => !document.error)?.url || null,
  });
}

const report = {
  version: 'batch14-official-evidence-v1',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: discovery.sourceBundleSha256,
  researchedCompanyCount: researched.length,
  requestedDocumentCount: tasks.length,
  successfulDocumentCount: researched.reduce((sum, company) => sum + company.successfulDocumentCount, 0),
  selectedForStructuring,
  companies: Object.fromEntries(researched.map(company => [company.code, company])),
};
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  researchedCompanyCount: report.researchedCompanyCount,
  requestedDocumentCount: report.requestedDocumentCount,
  successfulDocumentCount: report.successfulDocumentCount,
  selectedForStructuring,
  failedCompanies: researched.filter(company => company.successfulDocumentCount === 0).map(company => ({ code: company.code, name: company.name })),
}, null, 2));
