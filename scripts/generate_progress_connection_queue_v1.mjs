import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OUTPUT_JSON = path.join(ROOT, 'operations', 'production-quality', 'progress-connection-queue-v1.json');
const OUTPUT_CSV = path.join(ROOT, 'operations', 'production-quality', 'progress-connection-queue-v1.csv');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const stableGeneratedAt = sourceBundleSha256 => {
  if (!fs.existsSync(OUTPUT_JSON)) return new Date().toISOString();
  try {
    const previous = readJson(OUTPUT_JSON);
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

const pageEvidenceCount = company => (company.evidenceRefs || [])
  .filter(ref => /(?:p\.?\s*\d|ページ\s*\d|図版\s*\d)/i.test(String(ref))).length;
const metricKeys = ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'];

const rows = (bundle.companies || [])
  .filter(company => company.stage === 'detailed_extracted')
  .filter(company => !company.flags?.progress)
  .filter(company => Boolean(company.planPublishedDate) && pageEvidenceCount(company) >= 2)
  .map(company => {
    const targetMetricKeys = metricKeys.filter(key => Boolean(company[key]));
    return {
      priority: pageEvidenceCount(company) * 10 + targetMetricKeys.length,
      code: String(company.code),
      name: company.name,
      market: company.market,
      industry: company.industry,
      sourceUrl: company.sourceUrl,
      document: company.document,
      planPublishedDate: company.planPublishedDate,
      lastVerifiedDate: company.lastVerifiedDate,
      pageEvidenceCount: pageEvidenceCount(company),
      targetMetricKeys,
      targetMetricCount: targetMetricKeys.length,
      requiredWork: '最新の公式決算資料・統合報告書から、同一定義の実績値・対象年度・ページ番号を確認し、目標値と接続する',
      acceptanceCriteria: '公式URL、公表日、実績年度、指標定義、単位、ページ証跡、目標値との対応、独立再検証',
      automaticCompletionAllowed: false,
    };
  })
  .sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));

const report = {
  schemaVersion: 'progress-connection-queue-v1',
  generatedAt: stableGeneratedAt(manifest.sha256),
  sourceBundleSha256: manifest.sha256,
  queueCount: rows.length,
  automaticFactCompletion: false,
  automaticApproval: false,
  batches: {
    first10: rows.slice(0, 10).map(row => row.code),
    next20: rows.slice(10, 30).map(row => row.code),
    remaining: rows.slice(30).map(row => row.code),
  },
  rows,
};

fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
const header = ['priority', 'code', 'name', 'market', 'industry', 'sourceUrl', 'document', 'planPublishedDate', 'lastVerifiedDate', 'pageEvidenceCount', 'targetMetricKeys', 'targetMetricCount', 'requiredWork', 'acceptanceCriteria', 'automaticCompletionAllowed'];
const csv = [header.map(csvCell).join(',')]
  .concat(rows.map(row => header.map(key => csvCell(key === 'targetMetricKeys' ? row.targetMetricKeys.join('|') : row[key])).join(',')))
  .join('\n');
fs.writeFileSync(OUTPUT_CSV, `${csv}\n`);
console.log(JSON.stringify({ queueCount: rows.length, first10: report.batches.first10 }, null, 2));
