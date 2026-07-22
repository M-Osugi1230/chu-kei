import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'core-document-relevance-report-v1.json');

const STRATEGIC_DOCUMENT_PATTERN = /中期|中長期|長期経営|事業計画|経営計画|経営戦略|成長戦略|経営方針|企業価値|資本コスト|決算説明|決算補足|決算短信|統合報告|統合レポート|アニュアルレポート|会社説明|事業説明|IR資料|経営概況|事業方針/i;
const ADMINISTRATIVE_DOCUMENT_PATTERN = /株主優待|人事異動|役員人事|定款|株式分割|自己株式|剰余金の配当|配当予想|上場廃止|公開買付|訴訟|代表取締役|組織変更/i;
const METRIC_FIELDS = ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'];
const PAGE_PATTERN = /公式PDF\s*p\.?\s*(\d+)/gi;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest} !== ${manifest.sha256}`);
  return { manifest, bundle: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
}

function pagesFrom(value) {
  const pages = new Set();
  for (const match of String(value || '').matchAll(PAGE_PATTERN)) pages.add(Number(match[1]));
  return pages;
}

const { manifest, bundle } = readBundle();
const coreCompanies = (bundle.companies || []).filter(company => company.stage === 'core');
const irrelevantDocuments = [];
const metricEvidenceMismatches = [];

for (const company of coreCompanies) {
  const title = String(company.document || '');
  if (ADMINISTRATIVE_DOCUMENT_PATTERN.test(title) && !STRATEGIC_DOCUMENT_PATTERN.test(title)) {
    irrelevantDocuments.push({
      code: String(company.code),
      name: company.name,
      document: title,
      sourceUrl: company.sourceUrl,
    });
  }

  const evidencePages = new Set(
    (company.evidenceRefs || []).flatMap(reference => [...pagesFrom(reference)]),
  );
  for (const field of METRIC_FIELDS) {
    const metricPages = pagesFrom(company[field]);
    for (const page of metricPages) {
      if (!evidencePages.has(page)) {
        metricEvidenceMismatches.push({
          code: String(company.code),
          name: company.name,
          field,
          page,
          value: company[field],
          evidenceRefs: company.evidenceRefs || [],
        });
      }
    }
  }
}

const mismatchCompanyCodes = [...new Set(metricEvidenceMismatches.map(row => row.code))];
const issues = [
  ...irrelevantDocuments.map(row => ({ type: 'administrative_document_without_strategy_anchor', ...row })),
  ...metricEvidenceMismatches.map(row => ({ type: 'metric_page_missing_from_evidence_refs', ...row })),
];
const report = {
  version: 'core-document-relevance-v1.1',
  checkedAt: new Date().toISOString(),
  bundleSha256: manifest.sha256,
  companyCount: bundle.companies?.length || 0,
  coreCompanyCount: coreCompanies.length,
  irrelevantDocumentCount: irrelevantDocuments.length,
  metricEvidenceMismatchCount: metricEvidenceMismatches.length,
  metricEvidenceMismatchCompanyCount: mismatchCompanyCodes.length,
  allPassed: issues.length === 0,
  irrelevantDocuments,
  metricEvidenceMismatches,
  issues,
};

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  companyCount: report.companyCount,
  coreCompanyCount: report.coreCompanyCount,
  irrelevantDocumentCount: report.irrelevantDocumentCount,
  irrelevantDocuments,
  metricEvidenceMismatchCount: report.metricEvidenceMismatchCount,
  metricEvidenceMismatchCompanyCount: report.metricEvidenceMismatchCompanyCount,
  metricEvidenceMismatchSample: metricEvidenceMismatches.slice(0, 20).map(row => ({
    code: row.code,
    name: row.name,
    field: row.field,
    page: row.page,
  })),
  allPassed: report.allPassed,
}, null, 2));
if (!report.allPassed) {
  throw new Error(`Core document relevance audit failed: irrelevant=${irrelevantDocuments.length}, metricEvidenceMismatch=${metricEvidenceMismatches.length}, mismatchCompanies=${mismatchCompanyCodes.length}`);
}
