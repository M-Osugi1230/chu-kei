import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');

function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return JSON.parse(zlib.gunzipSync(compressed));
}
function hasPageEvidence(company) {
  return (company.evidenceRefs || []).some(ref => /(?:p\.?\s*\d|ページ\s*\d)/i.test(String(ref)));
}
function hasMetricExtraction(company) {
  return ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'].some(key => Boolean(company[key]));
}
function classify(company) {
  const gaps = [];
  if (!(typeof company.sourceUrl === 'string' && company.sourceUrl.startsWith('https://'))) gaps.push('officialSource');
  if (!company.planPublishedDate) gaps.push('publicationDate');
  if (!hasPageEvidence(company)) gaps.push('pageEvidence');
  if (!hasMetricExtraction(company)) gaps.push('metricExtraction');
  if (!company.flags?.progress) gaps.push('progressConnected');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(company.lastVerifiedDate || '')) gaps.push('lastVerifiedDate');

  let priority = 'P4';
  if (gaps.includes('officialSource') || gaps.includes('lastVerifiedDate')) priority = 'P0';
  else if (gaps.includes('publicationDate')) priority = 'P1';
  else if (gaps.includes('pageEvidence')) priority = 'P2';
  else if (gaps.includes('metricExtraction') || gaps.includes('progressConnected')) priority = 'P3';

  return { gaps, priority };
}
function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' / ') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

const data = readBundle();
const allCore = data.companies.filter(company => company.stage === 'core');
const queue = allCore
  .map(company => {
    const result = classify(company);
    return {
      priority: result.priority,
      code: company.code,
      name: company.name,
      market: company.market,
      industry: company.industry,
      qualityStars: company.quality?.stars ?? null,
      qualityScore: company.quality?.score ?? null,
      planPublishedDate: company.planPublishedDate ?? null,
      lastVerifiedDate: company.lastVerifiedDate,
      pageEvidence: hasPageEvidence(company),
      progressConnected: Boolean(company.flags?.progress),
      gaps: result.gaps,
      sourceUrl: company.sourceUrl,
      requiredAction: result.gaps.length ? result.gaps.join(', ') : 'none',
    };
  })
  .filter(item => item.gaps.length > 0)
  .sort((a, b) => a.priority.localeCompare(b.priority) || a.code.localeCompare(b.code));

const summary = {
  coreCompanies: allCore.length,
  repairQueue: queue.length,
  fiveStarCore: allCore.filter(company => company.quality?.stars === 5).length,
  publicationDateMissing: allCore.filter(company => !company.planPublishedDate).length,
  pageEvidenceMissing: allCore.filter(company => !hasPageEvidence(company)).length,
  progressMissing: allCore.filter(company => !company.flags?.progress).length,
  priorityCounts: Object.fromEntries(['P0', 'P1', 'P2', 'P3', 'P4'].map(priority => [priority, queue.filter(item => item.priority === priority).length])),
};

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const report = { version: 'production-repair-queue-v1', generatedAt: new Date().toISOString(), summary, items: queue };
fs.writeFileSync(path.join(ARTIFACT_DIR, 'production-repair-queue-v1.json'), `${JSON.stringify(report, null, 2)}\n`);
const headers = ['priority', 'code', 'name', 'market', 'industry', 'qualityStars', 'qualityScore', 'planPublishedDate', 'lastVerifiedDate', 'pageEvidence', 'progressConnected', 'gaps', 'sourceUrl'];
const lines = [headers.map(csvCell).join(',')];
for (const item of queue) lines.push(headers.map(header => csvCell(item[header])).join(','));
fs.writeFileSync(path.join(ARTIFACT_DIR, 'production-repair-queue-v1.csv'), `${lines.join('\n')}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`Artifacts: ${path.join(ARTIFACT_DIR, 'production-repair-queue-v1.json')}, ${path.join(ARTIFACT_DIR, 'production-repair-queue-v1.csv')}`);
