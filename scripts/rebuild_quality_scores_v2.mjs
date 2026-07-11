import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const SITE_DATA = path.join(ROOT, 'site', 'data');
const REPORT_DIR = path.join(ROOT, 'reports', 'v43');
const CHUNK_SIZE = 1536;
const WEIGHTS = {
  officialSource: 15,
  publicationDate: 10,
  pageEvidence: 15,
  structuredAnalysis: 15,
  metricExtraction: 15,
  progressConnected: 10,
  humanReviewed: 10,
  doubleChecked: 10,
};
const CHECK_LABELS = {
  officialSource: '公式資料確認済み',
  publicationDate: '資料公表日確認済み',
  pageEvidence: 'ページ証跡あり',
  structuredAnalysis: '主要論点構造化済み',
  metricExtraction: '数値・方針抽出済み',
  progressConnected: '進捗実績接続あり',
  humanReviewed: '人手レビュー済み',
  doubleChecked: 'ダブルチェック済み',
};
const EXTRACTION_STAGES = new Set(['core', 'detailed_extracted']);

function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE_DATA, 'bundle.manifest.json'), 'utf8'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(SITE_DATA, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return { manifest, data: JSON.parse(zlib.gunzipSync(compressed)) };
}
function hasPageEvidence(company) {
  return (company.evidenceRefs || []).some(ref => /(?:p\.?\s*\d|ページ\s*\d)/i.test(String(ref)));
}
function hasStructuredAnalysis(company) {
  if (!EXTRACTION_STAGES.has(company.stage)) return false;
  return Boolean(company.summary && company.summary.length >= 20)
    && Boolean((company.highlights || []).length || (company.themes || []).length);
}
function hasMetricExtraction(company) {
  if (!EXTRACTION_STAGES.has(company.stage)) return false;
  return ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'].some(key => Boolean(company[key]));
}
function buildChecks(company) {
  return {
    officialSource: company.stage !== 'jpx_indexed' && typeof company.sourceUrl === 'string' && company.sourceUrl.startsWith('https://'),
    publicationDate: Boolean(company.planPublishedDate),
    pageEvidence: hasPageEvidence(company),
    structuredAnalysis: hasStructuredAnalysis(company),
    metricExtraction: hasMetricExtraction(company),
    progressConnected: Boolean(company.flags?.progress),
    humanReviewed: company.stage === 'core',
    doubleChecked: company.stage === 'core',
  };
}
function profile(company) {
  const checks = buildChecks(company);
  if (company.stage === 'jpx_indexed') {
    return {
      version: '2.0',
      stars: 1,
      score: null,
      label: 'カバレッジβ',
      eligibleForScoring: false,
      checks,
      reasons: ['JPX上場情報確認済み', '中計資料未特定', '品質スコア算定対象外'],
      missing: Object.keys(checks).filter(key => !checks[key]),
    };
  }
  const score = Object.entries(checks).reduce((sum, [key, value]) => sum + (value ? WEIGHTS[key] : 0), 0);
  let stars;
  if (Object.values(checks).every(Boolean)) stars = 5;
  else if (score >= 65) stars = 4;
  else if (score >= 45) stars = 3;
  else if (checks.officialSource) stars = 2;
  else stars = 1;

  let label;
  if (stars === 5) label = '最高品質（進捗・証跡接続済み）';
  else if (company.stage === 'core') label = '本番品質（証跡補修対象）';
  else if (company.stage === 'detailed_extracted' && stars === 4) label = '詳細抽出済みβ（証跡充足）';
  else if (company.stage === 'detailed_extracted') label = '詳細抽出済みβ';
  else label = '一次確認β';

  const positives = Object.entries(checks).filter(([, value]) => value).map(([key]) => CHECK_LABELS[key]);
  const missing = Object.keys(checks).filter(key => !checks[key]);
  return {
    version: '2.0',
    stars,
    score,
    label,
    eligibleForScoring: true,
    checks,
    reasons: positives,
    missing,
  };
}
function distribution(companies) {
  return Object.fromEntries([5, 4, 3, 2, 1].map(stars => [stars, companies.filter(company => company.quality.stars === stars).length]));
}
function writeBundle(data, originalManifest) {
  const json = Buffer.from(JSON.stringify(data));
  const compressed = zlib.gzipSync(json, { level: 9, mtime: 0 });
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');

  for (const file of fs.readdirSync(SITE_DATA)) {
    if (/^bundle\.gz\.part\d+$/.test(file)) fs.rmSync(path.join(SITE_DATA, file));
  }
  const parts = [];
  for (let offset = 0, index = 0; offset < compressed.length; offset += CHUNK_SIZE, index += 1) {
    const part = compressed.subarray(offset, Math.min(offset + CHUNK_SIZE, compressed.length));
    const file = `bundle.gz.part${String(index).padStart(3, '0')}`;
    fs.writeFileSync(path.join(SITE_DATA, file), part);
    parts.push({ file, bytes: part.length, blobSha: null });
  }
  const manifest = {
    ...originalManifest,
    version: 'v43-quality-score-v2',
    format: 'gzip-json-chunks',
    compressedBytes: compressed.length,
    uncompressedBytes: json.length,
    sha256: digest,
    companyCount: data.companies.length,
    progressCount: data.progress.length,
    parts,
  };
  fs.writeFileSync(path.join(SITE_DATA, 'bundle.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const { manifest: originalManifest, data } = readBundle();
const before = distribution(data.companies);
for (const company of data.companies) company.quality = profile(company);
const after = distribution(data.companies);
const manifest = writeBundle(data, originalManifest);

const byStage = {};
for (const stage of ['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed']) {
  const rows = data.companies.filter(company => company.stage === stage);
  byStage[stage] = {
    companies: rows.length,
    distribution: distribution(rows),
    averageScore: rows.filter(company => company.quality.score != null).length
      ? Math.round(rows.filter(company => company.quality.score != null).reduce((sum, company) => sum + company.quality.score, 0) / rows.filter(company => company.quality.score != null).length * 10) / 10
      : null,
  };
}
fs.mkdirSync(REPORT_DIR, { recursive: true });
const report = {
  version: 'quality-score-v2',
  generatedAt: new Date().toISOString(),
  rule: { weights: WEIGHTS, extractionStages: [...EXTRACTION_STAGES], fiveStars: 'all eight evidence and review checks must be true', fourStars: 'score >= 65', threeStars: 'score >= 45', twoStars: 'official source confirmed', oneStar: 'coverage only or insufficient evidence' },
  before,
  after,
  byStage,
  bundle: { sha256: manifest.sha256, compressedBytes: manifest.compressedBytes, parts: manifest.parts.length },
};
fs.writeFileSync(path.join(REPORT_DIR, 'QUALITY_SCORE_V2_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
