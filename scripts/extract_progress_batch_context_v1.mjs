import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OUTPUT = path.join(ROOT, 'operations', 'production-quality', 'progress-batch-01-context.json');
const CODES = ['1925', '2267', '3086', '4478', '4661', '5333', '8233', '1801', '1802', '1803'];
const METRIC_KEYS = ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'];
const STANDARD_KEYS = new Set([
  'code', 'name', 'market', 'industry', 'stage', 'tier', 'sourceUrl', 'document',
  'planPublishedDate', 'lastVerifiedDate', 'summary', 'themes', 'highlights',
  'evidenceRefs', 'flags', 'warnings', 'quality', ...METRIC_KEYS,
]);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const stableGeneratedAt = sourceBundleSha256 => {
  if (!fs.existsSync(OUTPUT)) return new Date().toISOString();
  try {
    const previous = readJson(OUTPUT);
    if (previous.sourceBundleSha256 === sourceBundleSha256 && typeof previous.generatedAt === 'string') {
      return previous.generatedAt;
    }
  } catch {
    // Rebuild malformed or unreadable reports below.
  }
  return new Date().toISOString();
};

const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`Bundle SHA mismatch: ${digest} !== ${manifest.sha256}`);
const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const companiesByCode = new Map((bundle.companies || []).map(company => [String(company.code), company]));
const progressByCode = new Map();
for (const row of bundle.progress || []) {
  const code = String(row.code ?? '');
  const rows = progressByCode.get(code) || [];
  rows.push(row);
  progressByCode.set(code, rows);
}

const rows = CODES.map(code => {
  const company = companiesByCode.get(code);
  if (!company) throw new Error(`Missing company: ${code}`);
  const additionalFields = Object.fromEntries(
    Object.entries(company).filter(([key]) => !STANDARD_KEYS.has(key)),
  );
  return {
    code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    stage: company.stage,
    sourceUrl: company.sourceUrl,
    document: company.document,
    planPublishedDate: company.planPublishedDate,
    lastVerifiedDate: company.lastVerifiedDate,
    summary: company.summary,
    metrics: Object.fromEntries(METRIC_KEYS.filter(key => company[key] != null).map(key => [key, company[key]])),
    evidenceRefs: company.evidenceRefs || [],
    flags: company.flags || {},
    warnings: company.warnings || [],
    companyKeys: Object.keys(company).sort(),
    additionalFields,
    existingProgressRows: progressByCode.get(code) || [],
  };
});

const output = {
  schemaVersion: 'progress-batch-context-v1',
  generatedAt: stableGeneratedAt(manifest.sha256),
  sourceBundleSha256: manifest.sha256,
  automaticFactCompletion: false,
  codes: CODES,
  rows,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ companies: rows.length, codes: CODES }, null, 2));
