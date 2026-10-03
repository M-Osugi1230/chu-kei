import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const SOURCE_DIR = path.join(ROOT, 'site', 'data');
const OUTPUT_DIR = path.join(SOURCE_DIR, 'frontend');
const REPORT_DIR = path.join(ROOT, 'reports', 'v43');
const SHARD_SIZE = 20;
const INDEX_INITIAL_BUDGET = 256 * 1024;
const DETAIL_SHARD_BUDGET = 32 * 1024;
const CARD_SUMMARY_LENGTH = 48;
const CARD_THEME_LIMIT = 4;

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const gzipJson = value => zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9, mtime: 0 });
const metricCount = company => ['revenue', 'profit', 'margin', 'capital', 'returnPolicy']
  .filter(key => company[key] && company[key] !== '未抽出' && !String(company[key]).startsWith('未抽出')).length;
const compactSummary = value => {
  const text = String(value ?? '');
  return text.length > CARD_SUMMARY_LENGTH ? `${text.slice(0, CARD_SUMMARY_LENGTH)}…` : text;
};

const sourceManifest = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'bundle.manifest.json'), 'utf8'));
const sourceCompressed = Buffer.concat(
  sourceManifest.parts.map(part => fs.readFileSync(path.join(SOURCE_DIR, part.file))),
);
if (sha256(sourceCompressed) !== sourceManifest.sha256) throw new Error('Source bundle SHA-256 mismatch');
const source = JSON.parse(zlib.gunzipSync(sourceCompressed).toString('utf8'));

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const UNIVERSE_PATH = path.join(ROOT, 'operations', 'universe', 'current-universe-v1.json');
const PLAN_DETECTION_PATH = path.join(ROOT, 'operations', 'plan-detection', 'registry-v1.json');
const planDetection = fs.existsSync(PLAN_DETECTION_PATH)
  ? JSON.parse(fs.readFileSync(PLAN_DETECTION_PATH, 'utf8'))
  : { companies: [] };
if (!Array.isArray(planDetection.companies)) throw new Error('Invalid plan detection registry');
const planByCode = new Map(planDetection.companies.map(company => [String(company.code), company]));

const sourceByCode = new Map(source.companies.map(company => [String(company.code).toUpperCase(), company]));
let sourceOnlyCount = 0;
let universeOnlyCount = 0;
let universeCompanyCount = null;
let sorted = [...source.companies].sort((a, b) => String(a.code).localeCompare(String(b.code), 'ja'));

if (fs.existsSync(UNIVERSE_PATH)) {
  const universe = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf8'));
  if (universe.version !== 'company-universe-v1' || !Array.isArray(universe.companies)) {
    throw new Error('Unsupported company universe format');
  }

  universeCompanyCount = universe.companies.length;
  const universeCodes = new Set(universe.companies.map(company => String(company.code).toUpperCase()));
  sourceOnlyCount = source.companies.filter(company => !universeCodes.has(String(company.code).toUpperCase())).length;

  sorted = universe.companies.map(listing => {
    const code = String(listing.code).toUpperCase();
    const existing = sourceByCode.get(code);
    if (existing) {
      return {
        ...existing,
        code,
        name: listing.name,
        market: listing.market,
        industry: listing.industry,
        listingStatus: 'active',
        listingSource: 'JPX',
      };
    }

    universeOnlyCount += 1;
    const sourceUrl = `https://www2.jpx.co.jp/tseHpFront/StockSearch.do?method=topsearch&topSearchStr=${encodeURIComponent(code)}`;
    return {
      code,
      name: listing.name,
      market: listing.market,
      industry: listing.industry,
      category: `${listing.industry}/上場企業カバレッジ`,
      stage: 'jpx_indexed',
      tier: 'Coverageβ',
      sourceUrl,
      document: 'JPX上場会社情報',
      period: null,
      revenue: null,
      profit: null,
      margin: null,
      capital: null,
      returnPolicy: null,
      planPublishedDate: null,
      lastVerifiedDate: universe.sourceFetchedAt ? String(universe.sourceFetchedAt).slice(0, 10) : null,
      themes: [],
      summary: '企業探索用。JPXで現行上場・市場・業種を確認済み。中期経営計画の公式資料、目標数値、戦略テーマは未確認です。',
      highlights: [],
      warnings: ['Coverageβ。JPX上場情報のみ確認済みで、中期経営計画の公式資料は未確認です。'],
      evidenceRefs: [
        `JPX上場会社検索: ${sourceUrl}`,
        universe.sourceWorkbook ? `東証上場銘柄一覧: ${universe.sourceWorkbook}` : '東証上場銘柄一覧',
      ],
      flags: {},
      quality: null,
      listingStatus: 'active',
      listingSource: 'JPX',
    };
  }).sort((a, b) => String(a.code).localeCompare(String(b.code), 'ja'));
}
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
      summary: company.summary ?? '',
      themes: company.themes ?? [],
      revenue: company.revenue ?? null,
      profit: company.profit ?? null,
      margin: company.margin ?? null,
      capital: company.capital ?? null,
      returnPolicy: company.returnPolicy ?? null,
      highlights: company.highlights ?? [],
      warnings: company.warnings ?? [],
      evidenceRefs: company.evidenceRefs ?? [],
      progressAssessment: company.progressAssessment ?? null,
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
    planStatus: planByCode.get(String(company.code))?.status || 'not_checked',
    planStatusCheckedAt: planByCode.get(String(company.code))?.review?.checkedAt || null,
    lastVerifiedDate: company.lastVerifiedDate ?? null,
    planPublishedDate: company.planPublishedDate ?? null,
    themes: (company.themes ?? []).slice(0, CARD_THEME_LIMIT),
    summary: compactSummary(company.summary),
    quality: company.quality ? {
      stars: company.quality.stars,
      score: company.quality.score,
      label: company.quality.label,
      templateLike: company.quality.templateLike === true,
      deepVerificationStatus: company.quality.deepVerificationStatus || 'not_started',
      deepVerified: company.quality.deepVerified === true,
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
  companyCount: sorted.length,
  sourceBundleCompanyCount: source.companies.length,
  universeCompanyCount,
  universeOnlyCount,
  sourceOnlyCount,
  progressCount: (source.progress ?? []).length,
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
  version: 'frontend-data-shards-v1.3',
  generatedAt: manifest.generatedAt,
  sourceBundleSha256: sourceManifest.sha256,
  companyCount: sorted.length,
  sourceBundleCompanyCount: source.companies.length,
  universeCompanyCount,
  universeOnlyCount,
  sourceOnlyCount,
  structuredCompanyCount: sorted.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length,
  indexBytes: indexCompressed.length,
  manifestBytes,
  initialBytes,
  initialBudgetBytes: INDEX_INITIAL_BUDGET,
  initialBytesPerCompany: Number((initialBytes / sorted.length).toFixed(2)),
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
