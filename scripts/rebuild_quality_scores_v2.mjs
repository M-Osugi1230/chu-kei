import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  QUALITY_CHECK_KEYS,
  QUALITY_PROFILE_VERSION,
  QUALITY_WEIGHTS,
  buildQualityProfile,
} from './lib/quality_profile_v2.mjs';

const ROOT = path.resolve('.');
const SITE_DATA = path.join(ROOT, 'site', 'data');
const REPORT_DIR = path.join(ROOT, 'reports', 'v43');
const CHUNK_SIZE = 1536;

function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE_DATA, 'bundle.manifest.json'), 'utf8'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(SITE_DATA, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return { manifest, data: JSON.parse(zlib.gunzipSync(compressed)) };
}

function distribution(companies) {
  return Object.fromEntries(
    [5, 4, 3, 2, 1].map(stars => [
      stars,
      companies.filter(company => company.quality?.stars === stars).length,
    ]),
  );
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
for (const company of data.companies) company.quality = buildQualityProfile(company);
const after = distribution(data.companies);
const manifest = writeBundle(data, originalManifest);

const byStage = {};
for (const stage of ['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed']) {
  const rows = data.companies.filter(company => company.stage === stage);
  const scored = rows.filter(company => company.quality.score != null);
  byStage[stage] = {
    companies: rows.length,
    distribution: distribution(rows),
    averageScore: scored.length
      ? Math.round(scored.reduce((sum, company) => sum + company.quality.score, 0) / scored.length * 10) / 10
      : null,
  };
}

fs.mkdirSync(REPORT_DIR, { recursive: true });
const report = {
  version: 'quality-score-v2',
  generatedAt: new Date().toISOString(),
  profileVersion: QUALITY_PROFILE_VERSION,
  storage: {
    format: 'compact-bitmask',
    checkKeys: QUALITY_CHECK_KEYS,
    checkMaskBits: QUALITY_CHECK_KEYS.length,
    verboseChecksStoredInBundle: false,
  },
  rule: {
    weights: QUALITY_WEIGHTS,
    extractionStages: ['core', 'detailed_extracted'],
    fiveStars: 'all eight evidence and review checks must be true',
    fourStars: 'score >= 65',
    threeStars: 'score >= 45',
    twoStars: 'official source confirmed',
    oneStar: 'coverage only or insufficient evidence',
  },
  before,
  after,
  byStage,
  bundle: {
    sha256: manifest.sha256,
    compressedBytes: manifest.compressedBytes,
    parts: manifest.parts.length,
  },
};
fs.writeFileSync(
  path.join(REPORT_DIR, 'QUALITY_SCORE_V2_REPORT.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
