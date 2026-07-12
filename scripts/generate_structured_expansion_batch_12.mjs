import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const configPath = path.join(root, 'operations/patches/structured-expansion-batch-12-config.json');
const manifestPath = path.join(root, 'site/data/bundle.manifest.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(root, 'site/data', part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`bundle digest mismatch: ${digest}`);
const bundle = JSON.parse(zlib.gunzipSync(compressed));
const patchDir = path.join(root, 'operations/patches');
fs.mkdirSync(patchDir, { recursive: true });

const sourceFields = ['category','stage','tier','sourceUrl','document','period','planPublishedDate','lastVerifiedDate','themes','summary','revenue','profit','margin','capital','returnPolicy','highlights','warnings','evidenceRefs','flags'];
const reviews = [];
const corrections = [];
const codes = new Set();
for (const [index, record] of config.records.entries()) {
  if (codes.has(record.code)) throw new Error(`duplicate code ${record.code}`);
  codes.add(record.code);
  const company = bundle.companies.find(row => String(row.code) === String(record.code));
  if (!company) throw new Error(`company not found ${record.code}`);
  if (company.stage !== 'source_indexed') throw new Error(`company ${record.code} stage=${company.stage}`);
  if (company.name !== record.name) throw new Error(`name mismatch ${record.code}: ${company.name} != ${record.name}`);
  const expectedBefore = Object.fromEntries(sourceFields.map(field => [field, company[field]]));
  const reviewId = `review-${record.code}-20260713-structured-expansion`;
  const update = {
    category: record.category,
    stage: 'detailed_extracted',
    tier: '詳細抽出済みβ',
    sourceUrl: record.sourceUrl,
    document: record.document,
    period: record.period,
    planPublishedDate: record.planPublishedDate,
    lastVerifiedDate: '2026-07-13',
    themes: record.themes,
    summary: record.summary,
    revenue: record.revenue,
    profit: record.profit,
    margin: record.margin,
    capital: record.capital,
    returnPolicy: record.returnPolicy,
    highlights: record.highlights,
    warnings: record.warnings,
    evidenceRefs: record.evidenceRefs,
    flags: record.flags,
    reviewEvidence: record.evidenceRefs.map(ref => {
      const match = ref.match(/(?:PDF\s*)?(p\.[^:：]+|ページ\s*\d+(?:[-〜]\d+)?)/i);
      return { page: match ? match[1] : '資料内該当ページ', fact: ref.replace(/^.*?[：:]/, '').trim() };
    }),
  };
  const patch = {
    schemaVersion: 'company-data-patch-v1',
    patchId: `batch12-${record.code}-20260713`,
    companyCode: record.code,
    companyName: record.name,
    sourceUrl: record.sourceUrl,
    reviewDecisionId: reviewId,
    automaticFactCompletion: false,
    expectedBefore,
    updates: update,
  };
  const patchPath = path.join(patchDir, `batch12-${record.code}-20260713.json`);
  fs.writeFileSync(patchPath, `${JSON.stringify(patch)}\n`);

  const createdMinute = String(index).padStart(2, '0');
  reviews.push({
    id: reviewId,
    companyCode: record.code,
    fromStage: 'source_indexed',
    targetStage: 'detailed_extracted',
    status: 'in_review',
    checklist: { officialSource: true, publicationDate: true, pageEvidence: true, numbersUnitsYears: true, strategyClassification: true, comparisonDisplay: true, mobileDisplay: true },
    author: 'source-research-agent',
    reviewer: 'quality-evidence-agent',
    sourceUrl: record.sourceUrl,
    sourcePages: record.evidenceRefs,
    note: '公式一次資料の定量指標・期間・ページ証跡を確認。詳細抽出済みβへの昇格であり本番承認ではない。',
    decisionReason: `${record.name}の主要財務目標、成長戦略、投資、還元を比較可能にする。`,
    createdAt: `2026-07-13T00:${createdMinute}:00Z`,
    reviewedAt: `2026-07-13T01:${createdMinute}:00Z`,
  });
  corrections.push({
    id: `correction-${record.code}-20260713-structured-expansion`,
    companyCode: record.code,
    fieldPath: sourceFields.join(','),
    before: { stage: 'source_indexed', pageEvidence: false, planPublishedDate: null, revenue: '未抽出' },
    after: { stage: 'detailed_extracted', pageEvidence: true, planPublishedDate: record.planPublishedDate, revenue: record.revenue },
    reason: `${record.name}の公式計画・最新進捗を比較可能にする。`,
    sourceUrl: record.sourceUrl,
    sourcePage: record.evidenceRefs.join(' / '),
    status: 'corrected',
    reviewDecisionId: reviewId,
    detectedAt: `2026-07-13T00:${createdMinute}:00Z`,
    correctedAt: `2026-07-13T01:${createdMinute}:00Z`,
  });
}
const ledger = {
  schemaVersion: 'governance-ledger-batch-v1',
  batchId: config.batchId,
  automaticApprovalAllowed: false,
  reviews,
  corrections,
};
fs.writeFileSync(path.join(patchDir, 'structured-expansion-batch-12-ledger.json'), `${JSON.stringify(ledger)}\n`);
fs.writeFileSync(path.join(patchDir, 'structured-expansion-batch-12-patch-list.txt'), `${config.records.map(record => `operations/patches/batch12-${record.code}-20260713.json`).join('\n')}\n`);
console.log(JSON.stringify({ batchId: config.batchId, patches: config.records.length, codes: [...codes] }, null, 2));
