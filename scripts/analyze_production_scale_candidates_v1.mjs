import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OUTPUT = path.join(ROOT, 'operations', 'production-quality', 'production-scale-candidates-v1.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`Bundle SHA mismatch: ${digest} !== ${manifest.sha256}`);
const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const progressRows = Array.isArray(bundle.progress) ? bundle.progress : [];
const identifierKeys = ['companyCode', 'code', 'ticker', 'securityCode', 'company_code'];
const progressCodesFor = row => identifierKeys
  .filter(key => row && row[key] != null)
  .map(key => String(row[key]));
const progressByCode = new Map();
for (const row of progressRows) {
  for (const code of progressCodesFor(row)) {
    const rows = progressByCode.get(code) || [];
    rows.push(row);
    progressByCode.set(code, rows);
  }
}

const detailed = (bundle.companies || []).filter(company => company.stage === 'detailed_extracted');
const candidates = detailed.map(company => {
  const code = String(company.code);
  const matches = progressByCode.get(code) || [];
  return {
    code,
    name: company.name,
    lastVerifiedDate: company.lastVerifiedDate ?? null,
    planPublishedDate: company.planPublishedDate ?? null,
    evidenceRefCount: Array.isArray(company.evidenceRefs) ? company.evidenceRefs.length : 0,
    pageEvidenceRefCount: (company.evidenceRefs || []).filter(ref => /(?:p\.?\s*\d|ページ\s*\d|図版\s*\d)/i.test(String(ref))).length,
    hasProgressFlag: Boolean(company.flags?.progress),
    progressFlagValue: company.flags?.progress ?? null,
    matchedProgressRows: matches.length,
    matchedProgressSample: matches.slice(0, 2),
    companyFlagKeys: Object.keys(company.flags || {}),
  };
});

const missingOnlyProgressCodes = candidates
  .filter(row => !row.hasProgressFlag && row.pageEvidenceRefCount >= 2 && row.planPublishedDate)
  .map(row => row.code);
const progressExistsButFlagMissingCodes = candidates
  .filter(row => !row.hasProgressFlag && row.matchedProgressRows > 0)
  .map(row => row.code);

const report = {
  schemaVersion: 'production-scale-candidates-v1',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: manifest.sha256,
  companyCount: (bundle.companies || []).length,
  progressCount: progressRows.length,
  detailedExtractedCount: detailed.length,
  progressRowKeyShapes: [...new Set(progressRows.slice(0, 30).map(row => Object.keys(row || {}).sort().join('|')))],
  progressIdentifierCoverage: Object.fromEntries(identifierKeys.map(key => [key, progressRows.filter(row => row?.[key] != null).length])),
  counts: {
    detailedWithProgressFlag: candidates.filter(row => row.hasProgressFlag).length,
    detailedWithoutProgressFlag: candidates.filter(row => !row.hasProgressFlag).length,
    detailedWithMatchedProgressRows: candidates.filter(row => row.matchedProgressRows > 0).length,
    progressExistsButFlagMissing: progressExistsButFlagMissingCodes.length,
    pageEvidenceAndPublicationReadyButProgressMissing: missingOnlyProgressCodes.length,
  },
  queues: {
    progressExistsButFlagMissingCodes,
    pageEvidenceAndPublicationReadyButProgressMissingCodes: missingOnlyProgressCodes,
  },
  progressSamples: progressRows.slice(0, 5),
  candidates,
};

writeJson(OUTPUT, report);
console.log(JSON.stringify(report.counts, null, 2));
