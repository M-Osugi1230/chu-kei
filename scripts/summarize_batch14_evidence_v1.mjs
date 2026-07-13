import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const INPUT_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-evidence.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-selected-summary.json');
const input = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));

const companies = input.selectedForStructuring.map(selection => {
  const company = input.companies[String(selection.code)];
  if (!company) throw new Error(`Company evidence missing: ${selection.code}`);
  const documents = company.documents
    .filter(document => !document.error)
    .slice(0, 3)
    .map(document => ({
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
      firstPages: (document.firstPages || []).slice(0, 3).map(page => ({ page: page.page, text: page.text.slice(0, 1800) })),
      evidencePages: (document.evidencePages || []).slice(0, 8).map(page => ({
        page: page.page,
        metricHits: page.metricHits,
        strategyHits: page.strategyHits,
        snippet: page.snippet.slice(0, 1800),
      })),
    }));
  return {
    code: company.code,
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
});

const report = {
  version: 'batch14-selected-evidence-summary-v1',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: input.sourceBundleSha256,
  companyCount: companies.length,
  requestedDocumentCount: input.requestedDocumentCount,
  successfulDocumentCount: input.successfulDocumentCount,
  companies,
};
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  companyCount: report.companyCount,
  companies: companies.map(company => ({
    code: company.code,
    name: company.name,
    readinessScore: company.readinessScore,
    documents: company.documents.map(document => ({ url: document.url, anchorText: document.anchorText, evidenceScore: document.evidenceScore })),
  })),
}, null, 2));
