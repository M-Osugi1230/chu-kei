import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const gzipBytes = value => zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9, mtime: 0 }).length;
const clone = value => structuredClone(value);
const baseline = gzipBytes(payload);

const simulations = [];
const simulate = (name, mutate) => {
  const next = clone(payload);
  mutate(next);
  const bytes = gzipBytes(next);
  simulations.push({ name, bytes, savedBytes: baseline - bytes });
};

simulate('remove company.reviewEvidence', data => {
  for (const company of data.companies) delete company.reviewEvidence;
});
simulate('remove empty arrays and null optional fields', data => {
  for (const company of data.companies) {
    for (const [key, value] of Object.entries(company)) {
      if (value === null || (Array.isArray(value) && value.length === 0)) delete company[key];
    }
  }
});
simulate('remove company.reviewEvidence plus empty arrays/nulls', data => {
  for (const company of data.companies) {
    delete company.reviewEvidence;
    for (const [key, value] of Object.entries(company)) {
      if (value === null || (Array.isArray(value) && value.length === 0)) delete company[key];
    }
  }
});

const candidateFields = ['reviewEvidence', 'warnings', 'highlights', 'themes', 'evidenceRefs', 'tier', 'document', 'period', 'summary', 'capital', 'returnPolicy'];
for (const field of candidateFields) {
  simulate(`remove company.${field}`, data => {
    for (const company of data.companies) delete company[field];
  });
}

const fieldStats = {};
for (const company of payload.companies) {
  for (const [field, value] of Object.entries(company)) {
    const jsonBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    fieldStats[field] ??= { occurrences: 0, jsonBytes: 0 };
    fieldStats[field].occurrences += 1;
    fieldStats[field].jsonBytes += jsonBytes;
  }
}

const sourceIndexed = payload.companies
  .filter(company => company.stage === 'source_indexed')
  .map(company => ({ code: String(company.code), name: company.name, category: company.category, sourceUrl: company.sourceUrl }));

const structured = payload.companies.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length;
const report = {
  version: 'bundle-capacity-analysis-v1',
  generatedAt: new Date().toISOString(),
  baseline: {
    manifestCompressedBytes: manifest.compressedBytes,
    recompressedBytes: baseline,
    uncompressedBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    absoluteBudgetBytes: 131072,
    headroomBytes: 131072 - baseline,
    structuredCompanies: structured,
  },
  sourceIndexed,
  simulations: simulations.sort((a, b) => b.savedBytes - a.savedBytes),
  fieldStats: Object.fromEntries(Object.entries(fieldStats).sort((a, b) => b[1].jsonBytes - a[1].jsonBytes)),
};

fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts', 'bundle-capacity-analysis-v1.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
