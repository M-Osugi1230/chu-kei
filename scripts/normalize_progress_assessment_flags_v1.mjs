import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const CHUNK_SIZE = 1536;
const COMPLETED_STATUSES = new Set(['connected', 'not_comparable', 'not_disclosed']);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const manifestPath = path.join(DATA_DIR, 'bundle.manifest.json');
const manifest = readJson(manifestPath);
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest} !== ${manifest.sha256}`);
const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const changedCodes = [];
for (const company of bundle.companies || []) {
  const assessment = company.progressAssessment;
  const valid = assessment
    && COMPLETED_STATUSES.has(assessment.status)
    && String(assessment.reason || '').trim().length >= 20
    && String(assessment.sourceRef || '').trim();
  if (!valid || company.flags?.progress === true) continue;
  company.flags = { ...(company.flags || {}), progress: true };
  changedCodes.push(String(company.code));
}

if (!changedCodes.length) {
  console.log('Progress assessment flags are already normalized.');
  process.exit(0);
}

const json = Buffer.from(JSON.stringify(bundle), 'utf8');
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
writeJson(manifestPath, {
  ...manifest,
  compressedBytes: nextCompressed.length,
  uncompressedBytes: json.length,
  sha256: crypto.createHash('sha256').update(nextCompressed).digest('hex'),
  companyCount: bundle.companies.length,
  progressCount: bundle.progress.length,
  parts,
});
console.log(`Normalized progress-assessment flags for ${changedCodes.length} companies: ${changedCodes.join(', ')}`);
