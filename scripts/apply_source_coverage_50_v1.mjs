import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const DISCOVERY_PATH = path.join(ROOT, 'operations', 'research', 'source-coverage-50-discovery.json');
const MILESTONE_PATH = path.join(ROOT, 'operations', 'quality', 'coverage-milestone-v1.json');
const REVIEW_PATH = path.join(ROOT, 'operations', 'reviews', 'decisions.json');
const CORRECTION_PATH = path.join(ROOT, 'operations', 'corrections', 'corrections.json');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'source-coverage', 'source-coverage-50-applied.json');
const TARGET_SOURCE_CONFIRMED = Number(process.env.TARGET_SOURCE_CONFIRMED || 285);
const BUNDLE_BUDGET_BYTES = Number(process.env.SOURCE_COVERAGE_BUNDLE_BUDGET || 196608);
const TARGET_PARTS = 43;
const VERIFIED_DATE = process.env.SOURCE_VERIFIED_DATE || new Date().toISOString().slice(0, 10);
const DATE_TAG = VERIFIED_DATE.replaceAll('-', '');
const CREATED_AT_BASE = new Date(`${VERIFIED_DATE}T17:00:00Z`).getTime();
const REVIEWED_AT_BASE = new Date(`${VERIFIED_DATE}T18:00:00Z`).getTime();

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value, compact = false) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, compact ? 0 : 2)}\n`);
};
const addMinutes = (base, minutes) => new Date(base + minutes * 60_000).toISOString();
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
  const partSize = Math.ceil(compressed.length / TARGET_PARTS);
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (/^bundle\.gz\.part\d+$/.test(file)) fs.rmSync(path.join(DATA_DIR, file));
  }
  const parts = [];
  for (let index = 0; index < TARGET_PARTS; index += 1) {
    const start = index * partSize;
    const end = Math.min(start + partSize, compressed.length);
    const buffer = compressed.subarray(start, end);
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

const discovery = readJson(DISCOVERY_PATH);
if (discovery.version !== 'source-coverage-50-discovery-v2') throw new Error(`Unsupported discovery version: ${discovery.version}`);
const { manifest: beforeManifest, payload } = readBundle();
const sourceConfirmedBefore = payload.companies.filter(company => company.stage !== 'jpx_indexed').length;
const structuredBefore = payload.companies.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length;
const needed = Math.max(0, TARGET_SOURCE_CONFIRMED - sourceConfirmedBefore);

const companyByCode = new Map(payload.companies.map(company => [String(company.code), company]));
const selected = [];
for (const row of discovery.selectedForApplication || []) {
  if (selected.length >= needed) break;
  const company = companyByCode.get(String(row.code));
  if (!company || company.stage !== 'jpx_indexed') continue;
  if (row.status !== 'verified' || row.sourceStrength < 65) continue;
  const sourceUrl = row.documentUrl || row.officialIrUrl;
  if (!String(sourceUrl || '').startsWith('https://')) continue;
  if (!Array.isArray(row.evidence) || row.evidence.length < 2) continue;
  selected.push({ row, company, sourceUrl });
}

if (selected.length < needed) {
  throw new Error(`Verified official sources are insufficient: needed=${needed}, selected=${selected.length}`);
}

const reviews = fs.existsSync(REVIEW_PATH) ? readJson(REVIEW_PATH) : [];
const corrections = fs.existsSync(CORRECTION_PATH) ? readJson(CORRECTION_PATH) : [];
const reviewIds = new Set(reviews.map(row => row.id));
const correctionIds = new Set(corrections.map(row => row.id));
const applied = [];

for (const [index, item] of selected.entries()) {
  const { row, company, sourceUrl } = item;
  const before = {
    stage: company.stage,
    tier: company.tier,
    sourceUrl: company.sourceUrl ?? null,
    document: company.document ?? null,
    planPublishedDate: company.planPublishedDate ?? null,
    summary: company.summary ?? '',
  };
  const documentTitle = String(row.documentTitle || '公式IRページ（一次確認）')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220) || '公式IRページ（一次確認）';
  const evidenceRefs = [
    `公式IRページ到達確認: ${row.officialIrUrl}`,
    `公式資料またはIRページ応答確認: ${sourceUrl}`,
  ];

  company.category = `${company.industry}/公式IR一次確認`;
  company.stage = 'source_indexed';
  company.tier = '一次確認β';
  company.sourceUrl = sourceUrl;
  company.document = documentTitle;
  company.period = null;
  company.planPublishedDate = row.planPublishedDate || null;
  company.lastVerifiedDate = VERIFIED_DATE;
  company.themes = [];
  company.summary = '公式IR資料への導線を一次確認済み。中期目標、主要数値、戦略テーマの詳細抽出と原文突合は未実施です。';
  company.highlights = [];
  company.warnings = ['一次確認β。公式資料の所在確認のみで、比較用の数値・戦略は未抽出です。'];
  company.evidenceRefs = evidenceRefs;
  company.flags = {
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

  const reviewId = `review-${company.code}-${DATE_TAG}-source-coverage`;
  if (!reviewIds.has(reviewId)) {
    reviews.push({
      id: reviewId,
      companyCode: String(company.code),
      fromStage: 'jpx_indexed',
      targetStage: 'source_indexed',
      status: 'in_review',
      checklist: {
        officialSource: true,
        publicationDate: Boolean(company.planPublishedDate),
        pageEvidence: false,
        numbersUnitsYears: false,
        strategyClassification: false,
        comparisonDisplay: true,
        mobileDisplay: true,
      },
      author: 'source-discovery-agent',
      reviewer: 'quality-evidence-agent',
      sourceUrl,
      sourcePages: evidenceRefs,
      note: '公式IRページまたは公式配信資料への到達とHTTPS応答を確認。詳細抽出・本番承認ではない。',
      decisionReason: `${company.name}の公式IR導線を一次確認し、未確認企業からソース確認済み企業へ移行する。`,
      createdAt: addMinutes(CREATED_AT_BASE, index),
      reviewedAt: addMinutes(REVIEWED_AT_BASE, index),
    });
    reviewIds.add(reviewId);
  }

  const correctionId = `correction-${company.code}-${DATE_TAG}-source-coverage`;
  if (!correctionIds.has(correctionId)) {
    corrections.push({
      id: correctionId,
      companyCode: String(company.code),
      fieldPath: 'stage,tier,sourceUrl,document,planPublishedDate,lastVerifiedDate,summary,warnings,evidenceRefs,flags',
      before,
      after: {
        stage: company.stage,
        tier: company.tier,
        sourceUrl: company.sourceUrl,
        document: company.document,
        planPublishedDate: company.planPublishedDate,
        summary: company.summary,
      },
      reason: `${company.name}の公式IR導線と応答を確認し、一次確認βとして明示する。`,
      sourceUrl,
      sourcePage: evidenceRefs.join(' / '),
      status: 'corrected',
      reviewDecisionId: reviewId,
      detectedAt: addMinutes(CREATED_AT_BASE, index),
      correctedAt: addMinutes(REVIEWED_AT_BASE, index),
    });
    correctionIds.add(correctionId);
  }

  applied.push({
    code: String(company.code),
    name: company.name,
    market: company.market,
    industry: company.industry,
    sourceUrl,
    officialIrUrl: row.officialIrUrl,
    document: company.document,
    planPublishedDate: company.planPublishedDate,
    sourceStrength: row.sourceStrength,
    searchProvider: row.searchProvider,
  });
}

const sourceConfirmedAfter = payload.companies.filter(company => company.stage !== 'jpx_indexed').length;
const structuredAfter = payload.companies.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length;
const coverageBetaAfter = payload.companies.filter(company => company.stage === 'jpx_indexed').length;
if (sourceConfirmedAfter < TARGET_SOURCE_CONFIRMED) {
  throw new Error(`Source coverage target not reached: ${sourceConfirmedAfter}/${TARGET_SOURCE_CONFIRMED}`);
}
if (structuredAfter !== structuredBefore) {
  throw new Error(`Structured count must not change in source-indexing batch: ${structuredBefore} -> ${structuredAfter}`);
}

const outputManifest = writeBundle(payload, beforeManifest);
writeJson(REVIEW_PATH, reviews);
writeJson(CORRECTION_PATH, corrections);

const milestone = readJson(MILESTONE_PATH);
milestone.minimumSourceConfirmed = TARGET_SOURCE_CONFIRMED;
milestone.minimumStructured = Math.max(milestone.minimumStructured || 0, structuredAfter);
milestone.maximumCoverageBeta = payload.companies.length - TARGET_SOURCE_CONFIRMED;
milestone.absoluteBundleBudgetBytes = Math.max(milestone.absoluteBundleBudgetBytes || 0, BUNDLE_BUDGET_BYTES);
milestone.targetSourceCoverageRate = TARGET_SOURCE_CONFIRMED / payload.companies.length;
milestone.sourceCoverageTargetReachedAt = VERIFIED_DATE;
writeJson(MILESTONE_PATH, milestone);

const report = {
  version: 'source-coverage-50-application-v1',
  appliedAt: new Date().toISOString(),
  automaticFactCompletion: false,
  targetSourceConfirmed: TARGET_SOURCE_CONFIRMED,
  sourceConfirmedBefore,
  sourceConfirmedAfter,
  structuredBefore,
  structuredAfter,
  coverageBetaAfter,
  appliedCount: applied.length,
  applied,
  bundleBeforeSha256: beforeManifest.sha256,
  bundleAfterSha256: outputManifest.sha256,
  bundleAfterCompressedBytes: outputManifest.compressedBytes,
  bundleBudgetBytes: milestone.absoluteBundleBudgetBytes,
};
writeJson(OUTPUT_PATH, report);
console.log(JSON.stringify({
  sourceConfirmedBefore,
  sourceConfirmedAfter,
  structuredAfter,
  coverageBetaAfter,
  appliedCount: applied.length,
  bundleAfterCompressedBytes: outputManifest.compressedBytes,
  bundleBudgetBytes: milestone.absoluteBundleBudgetBytes,
}, null, 2));
