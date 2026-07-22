import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildQualityProfile } from './lib/quality_profile_v2.mjs';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const INPUT_PATH = path.join(ROOT, 'operations', 'research', 'jpx-listed-companies-latest.json');
const RUN_CONFIG_PATH = path.join(ROOT, 'operations', 'coverage-growth', 'run-company-coverage.json');
const MILESTONE_PATH = path.join(ROOT, 'operations', 'quality', 'coverage-milestone-v1.json');
const REPORT_PATH = path.join(ROOT, 'operations', 'coverage-growth', 'company-total-1000-report.json');
const ARCHIVE_PATH = path.join(ROOT, 'operations', 'research', 'delisted-company-archive-v1.json');
const TARGET_TOTAL = Number(process.env.TARGET_COMPANY_TOTAL || 1000);
const VERIFIED_DATE = process.env.COVERAGE_VERIFIED_DATE || new Date().toISOString().slice(0, 10);
const BUNDLE_BUDGET = Number(process.env.COMPANY_COVERAGE_BUNDLE_BUDGET || 262144);
const TARGET_PARTS = 43;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const gitBlobSha = buffer => crypto.createHash('sha1')
  .update(Buffer.from(`blob ${buffer.length}\0`))
  .update(buffer)
  .digest('hex');

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return { manifest, payload: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
}

function writeBundle(payload, originalManifest) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const compressed = zlib.gzipSync(json, { level: 9, mtime: 0 });
  if (compressed.length > BUNDLE_BUDGET) {
    throw new Error(`Expanded bundle exceeds budget: ${compressed.length} > ${BUNDLE_BUDGET}`);
  }
  const partSize = Math.ceil(compressed.length / TARGET_PARTS);
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (/^bundle\.gz\.part\d+$/.test(file)) fs.rmSync(path.join(DATA_DIR, file));
  }
  const parts = [];
  for (let index = 0; index < TARGET_PARTS; index += 1) {
    const buffer = compressed.subarray(index * partSize, Math.min((index + 1) * partSize, compressed.length));
    const file = `bundle.gz.part${String(index).padStart(3, '0')}`;
    fs.writeFileSync(path.join(DATA_DIR, file), buffer);
    parts.push({ file, bytes: buffer.length, blobSha: gitBlobSha(buffer) });
  }
  const manifest = {
    ...originalManifest,
    compressedBytes: compressed.length,
    uncompressedBytes: json.length,
    sha256: crypto.createHash('sha256').update(compressed).digest('hex'),
    companyCount: payload.companies.length,
    progressCount: payload.progress.length,
    parts,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

function normalizeMarket(value) {
  const text = String(value || '');
  if (!text.includes('内国株式')) return null;
  if (text.includes('プライム')) return 'Prime';
  if (text.includes('スタンダード')) return 'Standard';
  if (text.includes('グロース')) return 'Growth';
  return null;
}

function isValidIndustry(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !['-', '－', '—'].includes(text);
}

function diversifiedSelection(rows, count) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.market}|${row.industry}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const values of groups.values()) {
    values.sort((left, right) => left.code.localeCompare(right.code, 'ja'));
  }
  const keys = [...groups.keys()].sort((left, right) => left.localeCompare(right, 'ja'));
  const selected = [];
  while (selected.length < count) {
    let advanced = false;
    for (const key of keys) {
      const next = groups.get(key)?.shift();
      if (!next) continue;
      selected.push(next);
      advanced = true;
      if (selected.length >= count) break;
    }
    if (!advanced) break;
  }
  return selected;
}

function stageCounts(companies) {
  return Object.fromEntries(
    ['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed']
      .map(stage => [stage, companies.filter(company => company.stage === stage).length]),
  );
}

const jpx = readJson(INPUT_PATH);
if (jpx.version !== 'jpx-listed-companies-v1') throw new Error(`Unsupported JPX list version: ${jpx.version}`);
const runConfig = fs.existsSync(RUN_CONFIG_PATH) ? readJson(RUN_CONFIG_PATH) : {};
const replacementRows = Array.isArray(runConfig.replaceCompanies) ? runConfig.replaceCompanies : [];
const replacementByCode = new Map(replacementRows.map(row => [String(row.code).toUpperCase(), row]));
const replaceCodes = new Set(replacementByCode.keys());
const { manifest: beforeManifest, payload } = readBundle();
const beforeCount = payload.companies.length;

const removed = payload.companies.filter(company => replaceCodes.has(String(company.code).toUpperCase()));
if (removed.length !== replaceCodes.size) {
  const found = new Set(removed.map(company => String(company.code).toUpperCase()));
  const missing = [...replaceCodes].filter(code => !found.has(code));
  throw new Error(`Replacement codes missing from bundle: ${missing.join(', ')}`);
}
for (const company of removed) {
  if (company.stage !== 'jpx_indexed') {
    throw new Error(`Refusing to replace non-Coverageβ company: ${company.code} stage=${company.stage}`);
  }
}
payload.companies = payload.companies.filter(company => !replaceCodes.has(String(company.code).toUpperCase()));

if (removed.length) {
  const existingArchive = fs.existsSync(ARCHIVE_PATH)
    ? readJson(ARCHIVE_PATH)
    : { schemaVersion: 'delisted-company-archive-v1', companies: [] };
  const archivedByCode = new Map((existingArchive.companies || []).map(row => [String(row.code), row]));
  for (const company of removed) {
    const metadata = replacementByCode.get(String(company.code).toUpperCase()) || {};
    archivedByCode.set(String(company.code), {
      code: String(company.code),
      name: company.name,
      formerMarket: company.market,
      industry: company.industry,
      archivedAt: VERIFIED_DATE,
      delistedDate: metadata.delistedDate || null,
      delistingReason: metadata.reason || null,
      officialDelistingSource: metadata.officialSource || null,
      previousStage: company.stage,
      previousTier: company.tier,
      previousSourceUrl: company.sourceUrl,
    });
  }
  writeJson(ARCHIVE_PATH, {
    schemaVersion: 'delisted-company-archive-v1',
    updatedAt: VERIFIED_DATE,
    automaticDeletion: false,
    companies: [...archivedByCode.values()].sort((left, right) => String(left.code).localeCompare(String(right.code), 'ja')),
  });
}

const afterRemovalCount = payload.companies.length;
const needed = Math.max(0, TARGET_TOTAL - afterRemovalCount);
const existingCodes = new Set(payload.companies.map(company => String(company.code)));
const candidates = jpx.records
  .map(row => ({
    code: String(row.code).toUpperCase(),
    name: String(row.name || '').trim(),
    market: normalizeMarket(row.marketProduct),
    industry: String(row.industry33 || '').trim(),
    marketProduct: row.marketProduct,
  }))
  .filter(row => /^[0-9A-Z]{4}$/.test(row.code)
    && row.name
    && row.market
    && isValidIndustry(row.industry)
    && !existingCodes.has(row.code)
    && !replaceCodes.has(row.code));

const selected = diversifiedSelection(candidates, needed);
if (selected.length < needed) {
  throw new Error(`Official JPX list has insufficient eligible missing companies: needed=${needed}, selected=${selected.length}`);
}

const falseFlags = {
  ma: false,
  capitalEfficiency: false,
  shareholderReturn: false,
  progress: false,
  overseas: false,
  dx: false,
  humanCapital: false,
  newBusiness: false,
  restructuring: false,
};

const added = selected.map(row => {
  const sourceUrl = `https://www2.jpx.co.jp/tseHpFront/StockSearch.do?method=topsearch&topSearchStr=${encodeURIComponent(row.code)}`;
  const company = {
    code: row.code,
    name: row.name,
    market: row.market,
    industry: row.industry,
    category: `${row.industry}/上場企業カバレッジ`,
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
    lastVerifiedDate: VERIFIED_DATE,
    themes: [],
    summary: '企業探索用。JPXで上場・市場・業種を確認済み。中期経営計画の公式資料、目標数値、戦略テーマは未確認です。',
    highlights: [],
    warnings: ['Coverageβ。JPX上場情報のみ確認済みで、中期経営計画の公式資料は未確認です。'],
    evidenceRefs: [
      `JPX上場会社検索: ${sourceUrl}`,
      `東証上場銘柄一覧: ${jpx.sourceWorkbook}`,
    ],
    flags: { ...falseFlags },
  };
  company.quality = buildQualityProfile(company);
  return company;
});

payload.companies.push(...added);
payload.companies.sort((left, right) => String(left.code).localeCompare(String(right.code), 'ja'));
if (payload.companies.length !== TARGET_TOTAL) {
  throw new Error(`Company target not reached: ${payload.companies.length}/${TARGET_TOTAL}`);
}
if (new Set(payload.companies.map(company => String(company.code))).size !== TARGET_TOTAL) {
  throw new Error('Duplicate security codes detected after expansion');
}

const afterManifest = writeBundle(payload, beforeManifest);
const milestone = readJson(MILESTONE_PATH);
const stages = stageCounts(payload.companies);
const sourceConfirmed = TARGET_TOTAL - stages.jpx_indexed;
const structured = stages.core + stages.detailed_extracted;
milestone.companyTotal = TARGET_TOTAL;
milestone.minimumSourceConfirmed = Math.min(milestone.minimumSourceConfirmed || sourceConfirmed, sourceConfirmed);
milestone.minimumStructured = Math.min(milestone.minimumStructured || structured, structured);
milestone.maximumCoverageBeta = stages.jpx_indexed;
milestone.absoluteBundleBudgetBytes = Math.max(milestone.absoluteBundleBudgetBytes || 0, BUNDLE_BUDGET);
milestone.currentSourceCoverageRate = sourceConfirmed / TARGET_TOTAL;
milestone.targetCompanyTotal = TARGET_TOTAL;
milestone.companyCoverageTargetReachedAt = VERIFIED_DATE;
writeJson(MILESTONE_PATH, milestone);

const addedByMarket = Object.fromEntries(
  ['Prime', 'Standard', 'Growth'].map(market => [market, added.filter(company => company.market === market).length]),
);
const addedByIndustry = Object.fromEntries(
  [...new Set(added.map(company => company.industry))]
    .sort((left, right) => left.localeCompare(right, 'ja'))
    .map(industry => [industry, added.filter(company => company.industry === industry).length]),
);
writeJson(REPORT_PATH, {
  version: 'company-coverage-1000-v1',
  appliedAt: new Date().toISOString(),
  automaticFactCompletion: false,
  sourcePage: jpx.sourcePage,
  sourceWorkbook: jpx.sourceWorkbook,
  jpxRecordCount: jpx.recordCount,
  companyCountBefore: beforeCount,
  companyCountAfterRemoval: afterRemovalCount,
  companyCountAfter: payload.companies.length,
  removedCount: removed.length,
  removed: removed.map(company => ({
    code: company.code,
    name: company.name,
    metadata: replacementByCode.get(String(company.code).toUpperCase()) || null,
  })),
  addedCount: added.length,
  sourceConfirmed,
  structured,
  stages,
  addedByMarket,
  addedByIndustry,
  added: added.map(company => ({
    code: company.code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    sourceUrl: company.sourceUrl,
  })),
  bundleBeforeSha256: beforeManifest.sha256,
  bundleAfterSha256: afterManifest.sha256,
  bundleAfterCompressedBytes: afterManifest.compressedBytes,
  bundleBudgetBytes: milestone.absoluteBundleBudgetBytes,
});

console.log(JSON.stringify({
  companyCountBefore: beforeCount,
  companyCountAfterRemoval: afterRemovalCount,
  companyCountAfter: payload.companies.length,
  removedCount: removed.length,
  removedCodes: removed.map(company => String(company.code)),
  addedCount: added.length,
  addedCodes: added.map(company => String(company.code)),
  stages,
  sourceConfirmed,
  structured,
  bundleAfterCompressedBytes: afterManifest.compressedBytes,
}, null, 2));
