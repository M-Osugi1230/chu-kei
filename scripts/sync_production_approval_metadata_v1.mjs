import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { QUALITY_PROFILE_VERSION } from './lib/quality_profile_v2.mjs';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const REVIEW_PATH = path.join(ROOT, 'operations', 'reviews', 'decisions.json');
const CHUNK_SIZE = 1536;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const runNode = script => execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'inherit' });

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA mismatch: ${digest} !== ${manifest.sha256}`);
  return { manifest, bundle: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
}

function writeBundle(bundle, originalManifest) {
  const json = Buffer.from(JSON.stringify(bundle), 'utf8');
  const compressed = zlib.gzipSync(json, { level: 9, mtime: 0 });
  const sha256 = crypto.createHash('sha256').update(compressed).digest('hex');
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (/^bundle\.gz\.part\d+$/.test(file)) fs.rmSync(path.join(DATA_DIR, file));
  }
  const parts = [];
  for (let offset = 0, index = 0; offset < compressed.length; offset += CHUNK_SIZE, index += 1) {
    const part = compressed.subarray(offset, Math.min(offset + CHUNK_SIZE, compressed.length));
    const file = `bundle.gz.part${String(index).padStart(3, '0')}`;
    fs.writeFileSync(path.join(DATA_DIR, file), part);
    parts.push({ file, bytes: part.length, blobSha: null });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), `${JSON.stringify({
    ...originalManifest,
    compressedBytes: compressed.length,
    uncompressedBytes: json.length,
    sha256,
    companyCount: bundle.companies.length,
    progressCount: bundle.progress.length,
    parts,
  })}\n`);
}

const reviews = readJson(REVIEW_PATH);
const approvalsByCode = new Map();
for (const review of reviews) {
  if (review.status !== 'approved' || review.targetStage !== 'core') continue;
  const code = String(review.companyCode);
  const rows = approvalsByCode.get(code) || [];
  rows.push(review);
  approvalsByCode.set(code, rows);
}

const { manifest, bundle } = readBundle();
let changed = false;
for (const company of bundle.companies) {
  const code = String(company.code);
  if (company.stage !== 'core') {
    if (Object.hasOwn(company, 'productionApproval')) {
      delete company.productionApproval;
      changed = true;
    }
    continue;
  }
  const approvals = approvalsByCode.get(code) || [];
  const reviewers = [...new Set(approvals.map(row => String(row.reviewer || '')).filter(Boolean))].sort();
  const reviewedDates = approvals.map(row => row.reviewedAt).filter(Boolean).sort();
  const next = {
    reviewApproved: approvals.length >= 1,
    independentDoubleCheck: approvals.length >= 2 && reviewers.length >= 2,
    approvals: approvals.length,
    reviewers,
    latestReviewedAt: reviewedDates.at(-1) || null,
  };
  if (JSON.stringify(company.productionApproval || null) !== JSON.stringify(next)) {
    company.productionApproval = next;
    changed = true;
  }
}
const profileStale = bundle.companies.some(company => company.quality?.version !== QUALITY_PROFILE_VERSION);
if (!changed && !profileStale) {
  console.log('Production approval metadata and quality profile are already current.');
  process.exit(0);
}
writeBundle(bundle, manifest);
runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/normalize_bundle_contract_v1.mjs');
runNode('scripts/build_frontend_data_shards_v1.mjs');
if (fs.existsSync(path.join(ROOT, 'scripts', 'analyze_bundle_capacity_v1.mjs'))) runNode('scripts/analyze_bundle_capacity_v1.mjs');
console.log(`Synchronized production approval metadata for ${approvalsByCode.size} companies.`);
