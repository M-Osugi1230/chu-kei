import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const CHUNK_SIZE = 1536;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const manifestPath = path.join(DATA_DIR, 'bundle.manifest.json');
const manifest = readJson(manifestPath);
const compressed = Buffer.concat(
  manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))),
);
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error('Bundle SHA-256 mismatch');
const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const structured = (bundle.companies || []).filter(company => (
  ['core', 'detailed_extracted'].includes(company.stage)
  && typeof company.summary === 'string'
  && company.summary.trim().length >= 20
));
const groups = new Map();
for (const company of structured) {
  const key = company.summary.trim();
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(company);
}

const changed = [];
for (const [summary, companies] of groups.entries()) {
  if (companies.length < 2) continue;
  for (const company of companies) {
    const identity = `${company.name}（${company.code}）`;
    if (summary.startsWith(identity)) continue;
    company.summary = `${identity}は、${summary}`;
    changed.push(String(company.code));
  }
}

if (!changed.length) {
  console.log('Structured summaries are already unique.');
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

console.log(JSON.stringify({
  duplicateGroupCount: [...groups.values()].filter(rows => rows.length > 1).length,
  changedCount: changed.length,
  changedCodes: changed,
}, null, 2));
