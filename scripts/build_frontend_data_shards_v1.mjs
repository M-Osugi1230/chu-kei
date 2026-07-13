import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const SOURCE_DIR = path.join(ROOT, 'site', 'data');
const OUTPUT_DIR = path.join(SOURCE_DIR, 'frontend');
const REPORT_DIR = path.join(ROOT, 'reports', 'v43');
const SHARD_SIZE = 20;
const INDEX_INITIAL_BUDGET = 96 * 1024;
const DETAIL_SHARD_BUDGET = 32 * 1024;

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const gzipJson = value => zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9, mtime: 0 });
const metricCount = company => ['revenue', 'profit', 'margin', 'capital', 'returnPolicy']
  .filter(key => company[key] && company[key] !== '未抽出' && !String(company[key]).startsWith('未抽出')).length;

const sourceManifest = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'bundle.manifest.json'), 'utf8'));
const sourceCompressed = Buffer.concat(
  sourceManifest.parts.map(part => fs.readFileSync(path.join(SOURCE_DIR, part.file))),
);
if (sha256(sourceCompressed) !== sourceManifest.sha256) throw new Error('Source bundle SHA-256 mismatch');
const source = JSON.parse(zlib.gunzipSync(sourceCompressed).toString('utf8'));

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const sorted = [...source.companies].sort((a, b) => String(a.code).localeCompare(String(b.code), 'ja'));
const shards = [];
const detailFileByCode = new Map();

for (let offset = 0, shardIndex = 0; offset < sorted.length; offset += SHARD_SIZE, shardIndex += 1) {
  const rows = sorted.slice(offset, offset + SHARD_SIZE);
  const file = `details-${String(shardIndex).padStart(3, '0')}.json.gz`;
  const payload = {
    version: 'frontend-company-details-v1',
    companies: rows.map(company => ({
      code: String(company.code),
      category: company.category ?? null,
      sourceUrl: company.sourceUrl ?? null,
      document: company.document ?? null,
      period: company.period ?? null,
      revenue: company.revenue ?? null,
      profit: company.profit ?? null,
      margin: company.margin ?? null,
      capital: company.capital ?? null,
      returnPolicy: company.returnPolicy ?? null,
      highlights: company.highlights ?? [],
      warnings: company.warnings ?? [],
      evidenceRefs: company.evidenceRefs ?? [],
    })),
  };
  const compressed = gzipJson(payload);
  if (compressed.length > DETAIL_SHARD_BUDGET) {
    throw new Error(`${file} exceeds detail shard budget: ${compressed.length} > ${DETAIL_SHARD_BUDGET}`);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, file), compressed);
  for (const company of rows) detailFileByCode.set(String(company.code), file);
  shards.push({
    file,
    sha256: sha256(compressed),
    bytes: compressed.length,
    companyCount: rows.length,
    firstCode: String(rows[0].code),
    lastCode: String(rows.at(-1).code),
  });
}

const indexPayload = {
  version: 'frontend-company-index-v1',
  companies: sorted.map(company => ({
    code: String(company.code),
    name: company.name,
    market: company.market,
    industry: company.industry,
    stage: company.stage,
    tier: company.tier,
    lastVerifiedDate: company.lastVerifiedDate ?? null,
    planPublishedDate: company.planPublishedDate ?? null,
    themes: company.themes ?? [],
    summary: company.summary ?? '',
    quality: company.quality ? {
      stars: company.quality.stars,
      score: company.quality.score,
      label: company.quality.label,
      eligibleForScoring: company.quality.eligibleForScoring,
    } : null,
    flags: company.flags ?? {},
    metricCount: metricCount(company),
    detailFile: detailFileByCode.get(String(company.code)),
  })),
  progress: source.progress ?? [],
};
const indexFile = 'company-index.json.gz';
const indexCompressed = gzipJson(indexPayload);
fs.writeFileSync(path.join(OUTPUT_DIR, indexFile), indexCompressed);

const manifest = {
  version: 'frontend-data-manifest-v1',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: sourceManifest.sha256,
  companyCount: source.companies.length,
  progressCount: source.progress.length,
  index: {
    file: indexFile,
    sha256: sha256(indexCompressed),
    bytes: indexCompressed.length,
  },
  detailShards: shards,
};
const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
const manifestBytes = fs.statSync(manifestPath).size;
const initialBytes = manifestBytes + indexCompressed.length;
if (initialBytes > INDEX_INITIAL_BUDGET) {
  throw new Error(`Initial frontend data exceeds budget: ${initialBytes} > ${INDEX_INITIAL_BUDGET}`);
}

const report = {
  version: 'frontend-data-shards-v1',
  generatedAt: manifest.generatedAt,
  sourceBundleSha256: sourceManifest.sha256,
  companyCount: source.companies.length,
  structuredCompanyCount: source.companies.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length,
  indexBytes: indexCompressed.length,
  manifestBytes,
  initialBytes,
  initialBudgetBytes: INDEX_INITIAL_BUDGET,
  detailShardCount: shards.length,
  maxDetailShardBytes: Math.max(...shards.map(shard => shard.bytes)),
  detailShardBudgetBytes: DETAIL_SHARD_BUDGET,
  totalDetailBytes: shards.reduce((sum, shard) => sum + shard.bytes, 0),
};
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(REPORT_DIR, 'FRONTEND_DATA_SHARDS_V1_REPORT.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
