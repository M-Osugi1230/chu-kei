import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const PATCH_PATH = path.resolve(process.env.COMPANY_PATCH || 'operations/patches/nipponham-evidence-20260711.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const CHUNK_SIZE = 1536;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const stable = value => JSON.stringify(value);

const manifestPath = path.join(DATA_DIR, 'bundle.manifest.json');
const manifest = readJson(manifestPath);
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);

const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const patch = readJson(PATCH_PATH);
if (patch.schemaVersion !== 'company-data-patch-v1') throw new Error(`Unsupported patch schema: ${patch.schemaVersion}`);
if (patch.automaticFactCompletion !== false) throw new Error('automaticFactCompletion must be false');
if (!/^https:\/\//.test(patch.sourceUrl || '')) throw new Error('Patch sourceUrl must be HTTPS');
if (!patch.reviewDecisionId) throw new Error('Patch must link to a review decision');

const company = payload.companies.find(row => String(row.code) === String(patch.companyCode));
if (!company) throw new Error(`Company not found: ${patch.companyCode}`);
if (company.name !== patch.companyName) throw new Error(`Company name mismatch: ${company.name} !== ${patch.companyName}`);

for (const [field, expected] of Object.entries(patch.expectedBefore || {})) {
  const actual = company[field] ?? null;
  if (stable(actual) !== stable(expected)) {
    throw new Error(`Patch precondition failed for ${field}: actual=${stable(actual)} expected=${stable(expected)}`);
  }
}

const changedFields = [];
for (const [field, value] of Object.entries(patch.updates || {})) {
  if (stable(company[field] ?? null) !== stable(value)) changedFields.push(field);
  company[field] = value;
}
if (changedFields.length === 0) throw new Error('Patch produced no changes');

const json = Buffer.from(JSON.stringify(payload), 'utf8');
const nextCompressed = zlib.gzipSync(json, { level: 9, mtime: 0 });
for (const file of fs.readdirSync(DATA_DIR)) {
  if (/^bundle\.gz\.part\d+$/.test(file)) fs.rmSync(path.join(DATA_DIR, file));
}
const parts = [];
for (let offset = 0, index = 0; offset < nextCompressed.length; offset += CHUNK_SIZE, index += 1) {
  const part = nextCompressed.subarray(offset, Math.min(offset + CHUNK_SIZE, nextCompressed.length));
  const file = `bundle.gz.part${String(index).padStart(3, '0')}`;
  fs.writeFileSync(path.join(DATA_DIR, file), part);
  parts.push({ file, bytes: part.length, blobSha: null });
}
const nextManifest = {
  ...manifest,
  compressedBytes: nextCompressed.length,
  uncompressedBytes: json.length,
  sha256: crypto.createHash('sha256').update(nextCompressed).digest('hex'),
  companyCount: payload.companies.length,
  progressCount: payload.progress.length,
  parts,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const report = {
  version: 'company-data-patch-v1',
  appliedAt: new Date().toISOString(),
  patchId: patch.patchId,
  companyCode: patch.companyCode,
  companyName: patch.companyName,
  sourceUrl: patch.sourceUrl,
  reviewDecisionId: patch.reviewDecisionId,
  automaticFactCompletion: false,
  changedFields,
  outputSha256: nextManifest.sha256,
};
fs.writeFileSync(path.join(ARTIFACT_DIR, `${patch.patchId}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
