import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const WEIGHTS = {
  officialSource: 20,
  publicationDate: 15,
  pageEvidence: 20,
  structuredSummary: 15,
  metricExtraction: 15,
  progressConnected: 10,
  evidenceReferences: 5,
};
const CHECK_LABELS = {
  officialSource: '公式資料URL',
  publicationDate: '資料公表日',
  pageEvidence: 'ページ証跡',
  structuredSummary: '主要論点の構造化',
  metricExtraction: '数値・方針の抽出',
  progressConnected: '進捗データ接続',
  evidenceReferences: '原文証跡',
};

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
function assess(company) {
  const checks = {
    officialSource: typeof company.sourceUrl === 'string' && company.sourceUrl.startsWith('https://'),
    publicationDate: Boolean(company.planPublishedDate),
    pageEvidence: hasPageEvidence(company),
    structuredSummary: Boolean(company.summary && company.summary.length >= 20),
    metricExtraction: ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'].some(key => Boolean(company[key])),
    progressConnected: Boolean(company.flags?.progress),
    evidenceReferences: Boolean(company.evidenceRefs?.length),
  };
  return {
    checks,
    score: Object.entries(checks).reduce((sum, [key, value]) => sum + (value ? WEIGHTS[key] : 0), 0),
    missingChecks: Object.keys(checks).filter(key => !checks[key]),
  };
}
function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' / ') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

const data = readBundle();
const queue = data.companies
  .filter(company => company.stage === 'detailed_extracted')
  .map(company => {
    const assessment = assess(company);
    return {
      code: company.code,
      name: company.name,
      market: company.market,
      industry: company.industry,
      priority: assessment.checks.pageEvidence ? 'A' : 'B',
      documentationReadiness: assessment.score,
      qualityStars: company.quality.stars,
      sourceUrl: company.sourceUrl,
      planPublishedDate: company.planPublishedDate ?? null,
      lastVerifiedDate: company.lastVerifiedDate,
      missingChecks: assessment.missingChecks,
      missingLabels: assessment.missingChecks.map(key => CHECK_LABELS[key]),
      mandatoryHumanReview: [
        '原文との数値・単位・年度突合',
        '戦略分類の妥当性確認',
        '別確認者によるダブルチェック',
        '会社詳細・比較・スマホ表示監査',
      ],
    };
  })
  .sort((a, b) => a.priority.localeCompare(b.priority) || b.documentationReadiness - a.documentationReadiness || a.code.localeCompare(b.code));

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const jsonReport = {
  version: 'review-queue-v1',
  generatedAt: new Date().toISOString(),
  summary: {
    total: queue.length,
    priorityA: queue.filter(item => item.priority === 'A').length,
    priorityB: queue.filter(item => item.priority === 'B').length,
  },
  items: queue,
};
fs.writeFileSync(path.join(ARTIFACT_DIR, 'review-queue-v1.json'), `${JSON.stringify(jsonReport, null, 2)}\n`);
const headers = ['priority', 'code', 'name', 'market', 'industry', 'documentationReadiness', 'qualityStars', 'planPublishedDate', 'lastVerifiedDate', 'missingLabels', 'sourceUrl'];
const lines = [headers.map(csvCell).join(',')];
for (const item of queue) lines.push(headers.map(header => csvCell(item[header])).join(','));
fs.writeFileSync(path.join(ARTIFACT_DIR, 'review-queue-v1.csv'), `${lines.join('\n')}\n`);
console.log(JSON.stringify(jsonReport.summary, null, 2));
console.log(`Artifacts: ${path.join(ARTIFACT_DIR, 'review-queue-v1.json')}, ${path.join(ARTIFACT_DIR, 'review-queue-v1.csv')}`);
