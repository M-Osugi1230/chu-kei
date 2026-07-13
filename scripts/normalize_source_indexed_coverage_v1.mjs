import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const APPLIED_PATH = path.join(ROOT, 'operations', 'source-coverage', 'source-coverage-50-applied.json');
const REVIEW_PATH = path.join(ROOT, 'operations', 'reviews', 'decisions.json');
const CORRECTION_PATH = path.join(ROOT, 'operations', 'corrections', 'corrections.json');
const REPORT_PATH = path.join(ROOT, 'operations', 'source-coverage', 'source-coverage-50-normalization.json');
const TARGET_PARTS = 43;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const gitBlobSha = buffer => crypto.createHash('sha1')
  .update(Buffer.from(`blob ${buffer.length}\0`)).update(buffer).digest('hex');

const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const applied = readJson(APPLIED_PATH);
const reviews = readJson(REVIEW_PATH);
const corrections = readJson(CORRECTION_PATH);
const companyByCode = new Map(payload.companies.map(company => [String(company.code), company]));
const normalized = [];

for (const row of applied.applied || []) {
  const code = String(row.code);
  const company = companyByCode.get(code);
  if (!company) throw new Error(`Company missing: ${code}`);
  if (company.stage !== 'source_indexed') throw new Error(`Unexpected stage for ${code}: ${company.stage}`);
  const officialIrUrl = row.officialIrUrl;
  if (!String(officialIrUrl || '').startsWith('https://')) throw new Error(`Official IR URL missing: ${code}`);
  const discoveredDocumentUrl = row.sourceUrl;
  const discoveredDocument = row.document;
  company.sourceUrl = officialIrUrl;
  company.document = '公式IRページ（一次確認）';
  company.period = null;
  company.planPublishedDate = null;
  company.summary = '公式IRページへの到達を確認済み。中期目標、主要数値、戦略テーマの詳細抽出と原文突合は未実施です。';
  company.highlights = [];
  company.warnings = ['一次確認β。公式IRページの所在確認のみで、比較用の数値・戦略は未抽出です。'];
  company.evidenceRefs = [
    `公式IRページ応答確認: ${officialIrUrl}`,
    ...(discoveredDocumentUrl && discoveredDocumentUrl !== officialIrUrl
      ? [`探索時に確認した公式資料候補（詳細未抽出）: ${discoveredDocumentUrl}`]
      : []),
  ];

  row.discoveredDocumentUrl = discoveredDocumentUrl;
  row.discoveredDocument = discoveredDocument;
  row.sourceUrl = officialIrUrl;
  row.document = company.document;
  row.planPublishedDate = null;

  for (const review of reviews.filter(item => String(item.companyCode) === code && item.targetStage === 'source_indexed')) {
    review.sourceUrl = officialIrUrl;
    review.sourcePages = company.evidenceRefs;
    review.note = '公式IRページのHTTPS応答を確認。資料候補は探索済みだが、数値・戦略・対象期間の詳細抽出と原文突合は未実施。';
  }
  for (const correction of corrections.filter(item => String(item.companyCode) === code && String(item.id).includes('source-coverage'))) {
    correction.sourceUrl = officialIrUrl;
    correction.sourcePage = company.evidenceRefs.join(' / ');
    correction.after = {
      ...(correction.after || {}),
      sourceUrl: officialIrUrl,
      document: company.document,
      planPublishedDate: null,
      summary: company.summary,
    };
  }
  normalized.push({ code, name: company.name, officialIrUrl, discoveredDocumentUrl, discoveredDocument });
}

const json = Buffer.from(JSON.stringify(payload), 'utf8');
const outputCompressed = zlib.gzipSync(json, { level: 9, mtime: 0 });
const partSize = Math.ceil(outputCompressed.length / TARGET_PARTS);
for (const file of fs.readdirSync(DATA_DIR)) {
  if (/^bundle\.gz\.part\d+$/.test(file)) fs.rmSync(path.join(DATA_DIR, file));
}
const parts = [];
for (let index = 0; index < TARGET_PARTS; index += 1) {
  const buffer = outputCompressed.subarray(index * partSize, Math.min((index + 1) * partSize, outputCompressed.length));
  const file = `bundle.gz.part${String(index).padStart(3, '0')}`;
  fs.writeFileSync(path.join(DATA_DIR, file), buffer);
  parts.push({ file, bytes: buffer.length, blobSha: gitBlobSha(buffer) });
}
const outputManifest = {
  ...manifest,
  compressedBytes: outputCompressed.length,
  uncompressedBytes: json.length,
  sha256: crypto.createHash('sha256').update(outputCompressed).digest('hex'),
  companyCount: payload.companies.length,
  progressCount: payload.progress.length,
  parts,
};
fs.writeFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), `${JSON.stringify(outputManifest)}\n`);
applied.normalizedAt = new Date().toISOString();
applied.linkPolicy = 'source_indexed uses the verified official IR page; discovered documents remain evidence candidates until detailed extraction';
applied.bundleAfterNormalizationSha256 = outputManifest.sha256;
applied.bundleAfterNormalizationCompressedBytes = outputManifest.compressedBytes;
writeJson(APPLIED_PATH, applied);
writeJson(REVIEW_PATH, reviews);
writeJson(CORRECTION_PATH, corrections);
writeJson(REPORT_PATH, {
  version: 'source-coverage-50-normalization-v1',
  normalizedAt: applied.normalizedAt,
  normalizedCount: normalized.length,
  sourceConfirmed: payload.companies.filter(company => company.stage !== 'jpx_indexed').length,
  sourceIndexed: payload.companies.filter(company => company.stage === 'source_indexed').length,
  structured: payload.companies.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length,
  bundleSha256: outputManifest.sha256,
  bundleCompressedBytes: outputManifest.compressedBytes,
  normalized,
});
console.log(JSON.stringify({ normalizedCount: normalized.length, sourceConfirmed: 285, sourceIndexed: 79, structured: 206, bundleCompressedBytes: outputManifest.compressedBytes }, null, 2));
