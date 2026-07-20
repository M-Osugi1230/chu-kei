import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { isPrimaryEvidenceReference } from './lib/evidence_reference_v1.mjs';

const ROOT = path.resolve('.');
const CONFIG_PATH = path.resolve(process.env.STRUCTURED_EXPANSION_CONFIG || 'operations/patches/structured-expansion-batch-config.json');
const DATA_DIR = path.join(ROOT, 'site', 'data');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value, compact = false) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, compact ? `${JSON.stringify(value)}\n` : `${JSON.stringify(value, null, 2)}\n`);
};
const addMinutes = (iso, minutes) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'structured-expansion-batch-config-v2') {
  throw new Error(`Unsupported config schema: ${config.schemaVersion}`);
}
if (!config.batchId || !Array.isArray(config.records) || config.records.length === 0) {
  throw new Error('batchId and non-empty records are required');
}
if (!/^\d{8}$/.test(config.dateTag || '')) throw new Error('dateTag must be YYYYMMDD');
if (!/^\d{4}-\d{2}-\d{2}$/.test(config.lastVerifiedDate || '')) throw new Error('lastVerifiedDate must be YYYY-MM-DD');
if (!Number.isInteger(config.targetStructuredCount) || config.targetStructuredCount <= 0) {
  throw new Error('targetStructuredCount must be a positive integer');
}
const fromStage = config.fromStage || 'source_indexed';
if (!['source_indexed', 'jpx_indexed'].includes(fromStage)) throw new Error(`Unsupported fromStage: ${fromStage}`);
const targetStage = config.targetStage || 'detailed_extracted';
if (targetStage !== 'detailed_extracted') throw new Error(`Unsupported targetStage: ${targetStage}`);

const manifestPath = path.join(DATA_DIR, 'bundle.manifest.json');
const manifest = readJson(manifestPath);
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const expectedFields = [
  'category', 'stage', 'tier', 'sourceUrl', 'document', 'period', 'planPublishedDate',
  'lastVerifiedDate', 'themes', 'summary', 'revenue', 'profit', 'margin', 'capital',
  'returnPolicy', 'highlights', 'warnings', 'evidenceRefs', 'flags', 'progressAssessment',
];
const requiredRecordFields = [
  'code', 'name', 'category', 'sourceUrl', 'document', 'period', 'planPublishedDate',
  'themes', 'summary', 'revenue', 'profit', 'margin', 'capital', 'returnPolicy',
  'highlights', 'warnings', 'evidenceRefs', 'flags',
];
const allowedProgressAssessmentStatuses = new Set(['connected', 'not_comparable', 'not_disclosed']);
const codes = new Set();
const patchPaths = [];
const reviews = [];
const corrections = [];

for (const [index, record] of config.records.entries()) {
  for (const field of requiredRecordFields) {
    if (record[field] === undefined || record[field] === null) throw new Error(`${record.code || index}: missing ${field}`);
  }
  const code = String(record.code);
  if (!/^[0-9A-Z]{4}$/.test(code)) throw new Error(`Invalid company code: ${code}`);
  if (codes.has(code)) throw new Error(`Duplicate company code: ${code}`);
  codes.add(code);
  if (!/^https:\/\//.test(record.sourceUrl)) throw new Error(`${code}: sourceUrl must be HTTPS`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.planPublishedDate)) throw new Error(`${code}: invalid planPublishedDate`);
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.length < 2 || !record.evidenceRefs.every(isPrimaryEvidenceReference)) {
    throw new Error(`${code}: at least two PDF-page or official-Web-heading evidenceRefs are required`);
  }
  if (!Array.isArray(record.highlights) || record.highlights.length < 2) throw new Error(`${code}: highlights are insufficient`);
  if (!Array.isArray(record.warnings) || record.warnings.length < 2) throw new Error(`${code}: warnings are insufficient`);
  if (record.progressAssessment != null) {
    if (!allowedProgressAssessmentStatuses.has(record.progressAssessment.status)) {
      throw new Error(`${code}: unsupported progressAssessment status`);
    }
    if (!record.progressAssessment.reason || String(record.progressAssessment.reason).trim().length < 20) {
      throw new Error(`${code}: progressAssessment requires a detailed reason`);
    }
    if (!record.progressAssessment.sourceRef || !String(record.progressAssessment.sourceRef).trim()) {
      throw new Error(`${code}: progressAssessment requires sourceRef`);
    }
  }

  const company = payload.companies.find(row => String(row.code) === code);
  if (!company) throw new Error(`Company not found: ${code}`);
  if (company.name !== record.name) throw new Error(`${code}: name mismatch ${company.name} !== ${record.name}`);
  if (company.stage !== fromStage) throw new Error(`${code}: expected ${fromStage}, got ${company.stage}`);

  const expectedBefore = Object.fromEntries(expectedFields.map(field => [field, company[field] ?? null]));
  const reviewDecisionId = `review-${code}-${config.dateTag}-structured-expansion`;
  const patchId = `${config.patchPrefix || config.batchId}-${code}-${config.dateTag}`;
  const updates = {
    category: record.category,
    stage: targetStage,
    tier: '詳細抽出済みβ',
    sourceUrl: record.sourceUrl,
    document: record.document,
    period: record.period,
    planPublishedDate: record.planPublishedDate,
    lastVerifiedDate: config.lastVerifiedDate,
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
  };
  if (record.progressAssessment != null) updates.progressAssessment = record.progressAssessment;
  const patch = {
    schemaVersion: 'company-data-patch-v1',
    patchId,
    companyCode: code,
    companyName: record.name,
    sourceUrl: record.sourceUrl,
    reviewDecisionId,
    automaticFactCompletion: false,
    expectedBefore,
    updates,
  };
  const patchPath = path.join(ROOT, 'operations', 'patches', `${patchId}.json`);
  writeJson(patchPath, patch, true);
  patchPaths.push(path.relative(ROOT, patchPath));

  const createdAt = addMinutes(config.createdAtBase, index);
  const reviewedAt = addMinutes(config.reviewedAtBase, index);
  reviews.push({
    id: reviewDecisionId,
    companyCode: code,
    fromStage,
    targetStage,
    status: 'in_review',
    checklist: {
      officialSource: true,
      publicationDate: true,
      pageEvidence: true,
      numbersUnitsYears: true,
      strategyClassification: true,
      comparisonDisplay: true,
      mobileDisplay: true,
    },
    author: 'source-research-agent',
    reviewer: 'quality-evidence-agent',
    sourceUrl: record.sourceUrl,
    sourcePages: record.evidenceRefs,
    note: '公式一次資料の数値・方針・期間・ページ番号またはWeb見出し証跡を確認。詳細抽出済みβへの昇格であり本番承認ではない。',
    decisionReason: `${record.name}の主要財務目標、成長戦略、投資、還元、進捗評価を比較可能にする。`,
    createdAt,
    reviewedAt,
  });
  corrections.push({
    id: `correction-${code}-${config.dateTag}-structured-expansion`,
    companyCode: code,
    fieldPath: Object.keys(updates).join(','),
    before: {
      stage: company.stage,
      pageEvidence: (company.evidenceRefs || []).some(isPrimaryEvidenceReference),
      planPublishedDate: company.planPublishedDate ?? null,
      revenue: company.revenue ?? null,
      progressAssessment: company.progressAssessment ?? null,
    },
    after: {
      stage: targetStage,
      pageEvidence: true,
      planPublishedDate: record.planPublishedDate,
      revenue: record.revenue,
      progressAssessment: record.progressAssessment ?? null,
    },
    reason: `${record.name}の公式計画と進捗評価を比較可能にする。`,
    sourceUrl: record.sourceUrl,
    sourcePage: record.evidenceRefs.join(' / '),
    status: 'corrected',
    reviewDecisionId,
    detectedAt: createdAt,
    correctedAt: reviewedAt,
  });
}

const ledgerPath = path.join(ROOT, 'operations', 'patches', `${config.batchId}-ledger.json`);
writeJson(ledgerPath, {
  schemaVersion: 'governance-ledger-batch-v1',
  batchId: config.batchId,
  automaticApprovalAllowed: false,
  reviews,
  corrections,
}, true);

const patchListPath = path.join(ROOT, 'operations', 'patches', `${config.batchId}-patch-list.txt`);
fs.writeFileSync(patchListPath, `${patchPaths.join('\n')}\n`);

const testPath = path.join(ROOT, 'tests', 'e2e', `structured-count-${config.batchId}.spec.mjs`);
const companyLiteral = config.records.map(row => `  { code: '${String(row.code)}', name: ${JSON.stringify(row.name)} },`).join('\n');
const testSource = `import { test, expect } from '@playwright/test';\n\nconst expandedCompanies = [\n${companyLiteral}\n];\n\ntest('keeps at least ${config.targetStructuredCount} companies available for structured comparison', async ({ page }) => {\n  expect(expandedCompanies).toHaveLength(${config.records.length});\n  expect(new Set(expandedCompanies.map(company => company.code)).size).toBe(${config.records.length});\n  await page.goto('/');\n  await expect(page.locator('#stat-total')).toHaveText('${config.expectedCompanyCount || 570}社');\n  await expect(page.locator('#stat-confirmed')).toHaveText('${config.expectedSourceConfirmed || 200}社');\n  const structuredCount = Number((await page.locator('#stat-structured').textContent()).replace(/[^0-9]/g, ''));\n  expect(structuredCount).toBeGreaterThanOrEqual(${config.targetStructuredCount});\n});\n\ntest('exposes every ${config.batchId} company through search and detail', async ({ page }) => {\n  await page.goto('/');\n  for (const company of expandedCompanies) {\n    await page.locator('#search').fill(company.code);\n    await expect(page.locator('.company-card')).toHaveCount(1);\n    await expect(page.locator('.company-card')).toContainText(company.name);\n    await page.locator('[data-detail]').click();\n    await expect(page.locator('#company-dialog')).toBeVisible();\n    await expect(page.locator('#company-dialog h2')).toContainText(company.name);\n    await page.locator('#company-dialog [data-close]').click();\n  }\n});\n`;
fs.mkdirSync(path.dirname(testPath), { recursive: true });
fs.writeFileSync(testPath, testSource);

const report = {
  version: 'structured-expansion-batch-generator-v2.1',
  batchId: config.batchId,
  configPath: path.relative(ROOT, CONFIG_PATH),
  records: config.records.length,
  fromStage,
  targetStage,
  targetStructuredCount: config.targetStructuredCount,
  patchPaths,
  ledgerPath: path.relative(ROOT, ledgerPath),
  testPath: path.relative(ROOT, testPath),
  sourceBundleSha256: manifest.sha256,
  deterministic: true,
};
fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
writeJson(path.join(ROOT, 'artifacts', `${config.batchId}-generator-report.json`), report);
console.log(JSON.stringify(report, null, 2));
