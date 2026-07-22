import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const MARKER_PATH = path.join(ROOT, 'operations', 'patches', 'run-metric-evidence-alignment.json');
const REPORT_PATH = path.join(ROOT, 'operations', 'quality', 'metric-evidence-alignment-report-v1.json');
const PAGE_PATTERN = /公式PDF\s*p\.?\s*(\d+)/gi;
const FIELD_LABELS = {
  revenue: '売上高・売上収益',
  profit: '利益',
  margin: '収益性・資本効率',
  capital: '投資・資本配分',
  returnPolicy: '株主還元',
  progressAssessment: '進捗評価',
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const gitBlobSha = buffer => crypto
  .createHash('sha1')
  .update(Buffer.from(`blob ${buffer.length}\0`))
  .update(buffer)
  .digest('hex');

if (!fs.existsSync(MARKER_PATH)) {
  console.log('No metric evidence alignment marker found.');
  process.exit(0);
}

const marker = readJson(MARKER_PATH);
if (marker.schemaVersion !== 'metric-evidence-alignment-run-v1') {
  throw new Error(`Unsupported metric evidence alignment marker: ${marker.schemaVersion}`);
}
if (marker.runRequested !== true) throw new Error('Metric evidence alignment requires runRequested=true');
if (marker.automaticFactCompletion !== false) throw new Error('automaticFactCompletion must be false');
if (marker.derivedFromExistingReferences !== true) throw new Error('derivedFromExistingReferences must be true');

const manifestPath = path.join(DATA_DIR, 'bundle.manifest.json');
const manifest = readJson(manifestPath);
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest} !== ${manifest.sha256}`);
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const pagesFrom = value => {
  const pages = new Set();
  for (const match of String(value || '').matchAll(PAGE_PATTERN)) pages.add(Number(match[1]));
  return pages;
};

const affectedCompanies = [];
let addedReferenceCount = 0;
for (const company of payload.companies || []) {
  if (company.stage !== 'core') continue;
  const existingRefs = Array.isArray(company.evidenceRefs) ? [...company.evidenceRefs] : [];
  const existingPages = new Set(existingRefs.flatMap(reference => [...pagesFrom(reference)]));
  const pageLabels = new Map();

  for (const field of ['revenue', 'profit', 'margin', 'capital', 'returnPolicy']) {
    for (const page of pagesFrom(company[field])) {
      if (!pageLabels.has(page)) pageLabels.set(page, new Set());
      pageLabels.get(page).add(FIELD_LABELS[field]);
    }
  }
  for (const page of pagesFrom(company.progressAssessment?.sourceRef)) {
    if (!pageLabels.has(page)) pageLabels.set(page, new Set());
    pageLabels.get(page).add(FIELD_LABELS.progressAssessment);
  }

  const added = [];
  for (const [page, labels] of [...pageLabels.entries()].sort((a, b) => a[0] - b[0])) {
    if (existingPages.has(page)) continue;
    const labelText = [...labels].join('・');
    const reference = `公式PDF p.${page}: ${labelText}欄が参照する数値または方針の一次証跡。`;
    existingRefs.push(reference);
    existingPages.add(page);
    added.push(reference);
    addedReferenceCount += 1;
  }

  if (added.length > 0) {
    company.evidenceRefs = [...new Set(existingRefs)];
    affectedCompanies.push({
      code: String(company.code),
      name: company.name,
      addedReferenceCount: added.length,
      addedReferences: added,
    });
  }
}

const beforeSha256 = manifest.sha256;
const json = Buffer.from(JSON.stringify(payload), 'utf8');
const nextCompressed = zlib.gzipSync(json, { level: 9, mtime: 0 });
const targetParts = manifest.parts.length || 43;
const partSize = Math.ceil(nextCompressed.length / targetParts);
for (const file of fs.readdirSync(DATA_DIR).filter(name => /^bundle\.gz\.part\d+$/.test(name))) {
  fs.rmSync(path.join(DATA_DIR, file));
}
const parts = [];
for (let index = 0; index < targetParts; index += 1) {
  const start = index * partSize;
  const end = Math.min(start + partSize, nextCompressed.length);
  const buffer = nextCompressed.subarray(start, end);
  const file = `bundle.gz.part${String(index).padStart(3, '0')}`;
  fs.writeFileSync(path.join(DATA_DIR, file), buffer);
  parts.push({ file, bytes: buffer.length, blobSha: gitBlobSha(buffer) });
}
const nextManifest = {
  ...manifest,
  compressedBytes: nextCompressed.length,
  uncompressedBytes: json.length,
  sha256: crypto.createHash('sha256').update(nextCompressed).digest('hex'),
  companyCount: payload.companies?.length || 0,
  progressCount: payload.progress?.length || 0,
  parts,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest)}\n`);

writeJson(REPORT_PATH, {
  schemaVersion: 'metric-evidence-alignment-report-v1',
  appliedAt: new Date().toISOString(),
  automaticFactCompletion: false,
  derivedFromExistingReferences: true,
  metricValuesChanged: false,
  companyCount: payload.companies?.length || 0,
  affectedCompanyCount: affectedCompanies.length,
  addedReferenceCount,
  beforeBundleSha256: beforeSha256,
  afterBundleSha256: nextManifest.sha256,
  affectedCompanies,
});
fs.rmSync(MARKER_PATH);
console.log(JSON.stringify({
  affectedCompanyCount: affectedCompanies.length,
  addedReferenceCount,
  metricValuesChanged: false,
  beforeBundleSha256: beforeSha256,
  afterBundleSha256: nextManifest.sha256,
}, null, 2));
