import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const INPUT_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-evidence.json');
const OUTPUT_DIR = path.join(ROOT, 'operations', 'research', 'batch14-researched');
const input = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
const companies = Object.values(input.companies).sort((a, b) => b.readinessScore - a.readinessScore || String(a.code).localeCompare(String(b.code)));

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const index = [];
for (const company of companies) {
  const code = String(company.code);
  const documents = company.documents.filter(document => !document.error).slice(0, 3).map(document => ({
    url: document.url,
    requestedUrl: document.requestedUrl,
    anchorText: document.anchorText,
    sourcePage: document.sourcePage,
    candidateScore: document.candidateScore,
    evidenceScore: document.evidenceScore,
    pageCount: document.pageCount,
    metricHits: document.metricHits,
    strategyHits: document.strategyHits,
    recentYearHits: document.recentYearHits,
    firstPages: (document.firstPages || []).slice(0, 4),
    evidencePages: (document.evidencePages || []).slice(0, 20),
  }));
  const output = {
    version: 'batch14-company-evidence-v1',
    code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    readinessScore: company.readinessScore,
    officialIrUrl: company.officialIrUrl,
    successfulDocumentCount: company.successfulDocumentCount,
    pageEvidenceCount: company.pageEvidenceCount,
    recentDocumentCount: company.recentDocumentCount,
    documents,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, `${code}.json`), `${JSON.stringify(output, null, 2)}\n`);
  index.push({
    code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    readinessScore: company.readinessScore,
    officialIrUrl: company.officialIrUrl,
    successfulDocumentCount: company.successfulDocumentCount,
    pageEvidenceCount: company.pageEvidenceCount,
    recentDocumentCount: company.recentDocumentCount,
    documents: documents.map(document => ({ url: document.url, anchorText: document.anchorText, evidenceScore: document.evidenceScore, pageCount: document.pageCount, recentYearHits: document.recentYearHits })),
  });
}

const report = {
  version: 'batch14-researched-index-v1',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: input.sourceBundleSha256,
  companyCount: index.length,
  companies: index,
};
fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
