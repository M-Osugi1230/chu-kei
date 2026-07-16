import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { countPrimaryEvidenceReferences } from './lib/evidence_reference_v1.mjs';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OPS_DIR = path.join(ROOT, 'operations');
const TARGET_PATH = path.join(OPS_DIR, 'production-quality', 'production-quality-target-v1.json');
const OUTPUT_JSON = path.join(OPS_DIR, 'production-quality', 'production-readiness-v1.json');
const OUTPUT_CSV = path.join(OPS_DIR, 'production-quality', 'production-readiness-queue-v1.csv');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest} !== ${manifest.sha256}`);
  return { manifest, bundle: JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) };
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (entry.isFile() && /ledger.*\.json$|.*-ledger\.json$/.test(entry.name)) results.push(full);
  }
  return results;
}

function productionApprovals() {
  const byCode = new Map();
  for (const file of walk(OPS_DIR)) {
    let ledger;
    try { ledger = readJson(file); } catch { continue; }
    for (const review of ledger.reviews || []) {
      if (review.targetStage !== 'core' || review.status !== 'approved') continue;
      const code = String(review.companyCode);
      const rows = byCode.get(code) || [];
      rows.push({
        id: review.id,
        reviewer: String(review.reviewer || review.author || 'unknown'),
        reviewedAt: review.reviewedAt || review.createdAt || null,
        source: path.relative(ROOT, file),
      });
      byCode.set(code, rows);
    }
  }
  return byCode;
}

const hasPageEvidence = (company, minimum) => countPrimaryEvidenceReferences(company.evidenceRefs) >= minimum;
const hasStructuredAnalysis = company => Boolean(company.summary && company.summary.length >= 20)
  && Boolean((company.highlights || []).length || (company.themes || []).length);
const hasMetricExtraction = company => ['revenue', 'profit', 'margin', 'capital', 'returnPolicy']
  .some(key => Boolean(company[key]));
const ageDays = (date, reference) => {
  if (!date || Number.isNaN(Date.parse(date))) return null;
  return Math.floor((reference.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86400000);
};
const japanDate = instant => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const target = readJson(TARGET_PATH);
if (target.schemaVersion !== 'production-quality-target-v1') throw new Error(`Unsupported target schema: ${target.schemaVersion}`);
const { manifest, bundle } = readBundle();
const approvalsByCode = productionApprovals();
const referenceDateValue = process.env.QUALITY_AS_OF_DATE || japanDate(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDateValue)) throw new Error(`Invalid QUALITY_AS_OF_DATE: ${referenceDateValue}`);
const referenceDate = new Date(`${referenceDateValue}T00:00:00Z`);

const rows = bundle.companies.map(company => {
  const code = String(company.code);
  const approvals = approvalsByCode.get(code) || [];
  const distinctReviewers = [...new Set(approvals.map(row => row.reviewer))];
  const days = ageDays(company.lastVerifiedDate, referenceDate);
  const checks = {
    officialSource: company.stage !== 'jpx_indexed' && typeof company.sourceUrl === 'string' && company.sourceUrl.startsWith('https://'),
    publicationDate: Boolean(company.planPublishedDate),
    pageEvidence: hasPageEvidence(company, target.minimumPageEvidenceRefs),
    structuredAnalysis: ['core', 'detailed_extracted'].includes(company.stage) && hasStructuredAnalysis(company),
    metricExtraction: ['core', 'detailed_extracted'].includes(company.stage) && hasMetricExtraction(company),
    progressConnected: Boolean(company.flags?.progress),
    freshness: days != null && days >= 0 && days <= target.freshnessDays,
    productionReviewApproved: approvals.length >= 1,
    independentDoubleCheckApproved: approvals.length >= target.minimumProductionApprovals
      && (!target.reviewerIndependenceRequired || distinctReviewers.length >= target.minimumProductionApprovals),
  };
  const machineReady = target.requiredMachineChecks.every(key => checks[key]);
  const approvalReady = target.requiredApprovalChecks.every(key => checks[key]);
  const productionReady = machineReady && approvalReady;
  const missing = [...target.requiredMachineChecks, ...target.requiredApprovalChecks].filter(key => !checks[key]);
  const priority = (company.stage === 'core' ? 500 : company.stage === 'detailed_extracted' ? 400 : company.stage === 'source_indexed' ? 200 : 0)
    + Object.values(checks).filter(Boolean).length * 10
    + (company.quality?.score || 0);
  return {
    code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    stage: company.stage,
    stars: company.quality?.stars ?? null,
    score: company.quality?.score ?? null,
    lastVerifiedDate: company.lastVerifiedDate ?? null,
    machineReady,
    approvalReady,
    productionReady,
    approvals: approvals.length,
    distinctReviewers: distinctReviewers.length,
    missing,
    checks,
    priority,
  };
});

rows.sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));
const count = predicate => rows.filter(predicate).length;
const byStage = Object.fromEntries(['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed'].map(stage => [stage, count(row => row.stage === stage)]));
const missingCounts = Object.fromEntries(
  [...target.requiredMachineChecks, ...target.requiredApprovalChecks].map(key => [key, count(row => !row.checks[key])]),
);
const currentProduction = byStage.core;
const targetProduction = target.targetProductionCompanies;
const report = {
  schemaVersion: 'production-readiness-report-v1',
  generatedAt: referenceDate.toISOString(),
  referenceDate: referenceDate.toISOString().slice(0, 10),
  bundleSha256: manifest.sha256,
  companyCount: rows.length,
  targetProduction,
  currentProduction,
  productionGap: Math.max(0, targetProduction - currentProduction),
  currentFiveStar: count(row => row.stars === 5),
  machineReady: count(row => row.machineReady),
  machineReadyNotProduction: count(row => row.machineReady && row.stage !== 'core'),
  fullyApprovedAndReady: count(row => row.productionReady),
  coreMeetingAllRequirements: count(row => row.stage === 'core' && row.productionReady),
  byStage,
  missingCounts,
  queues: {
    productionReadyCodes: rows.filter(row => row.productionReady && row.stage !== 'core').map(row => row.code),
    approvalRequiredCodes: rows.filter(row => row.machineReady && !row.approvalReady).map(row => row.code),
    machineRepairCodes: rows.filter(row => ['core', 'detailed_extracted'].includes(row.stage) && !row.machineReady).map(row => row.code),
    sourceExpansionCodes: rows.filter(row => ['source_indexed', 'jpx_indexed'].includes(row.stage)).map(row => row.code),
  },
  invariants: {
    automaticPromotionAllowed: target.automaticPromotionAllowed,
    noAutomaticPromotion: target.automaticPromotionAllowed === false,
    targetWithinUniverse: targetProduction <= rows.length,
  },
};
if (!report.invariants.noAutomaticPromotion || !report.invariants.targetWithinUniverse) throw new Error('Production target invariants failed');
writeJson(OUTPUT_JSON, report);

const header = ['priority', 'code', 'name', 'market', 'industry', 'stage', 'stars', 'score', 'machineReady', 'approvalReady', 'productionReady', 'approvals', 'distinctReviewers', 'lastVerifiedDate', 'missing'];
const csv = [header.map(csvCell).join(',')]
  .concat(rows.map(row => header.map(key => csvCell(key === 'missing' ? row.missing.join('|') : row[key])).join(',')))
  .join('\n');
fs.writeFileSync(OUTPUT_CSV, `${csv}\n`);
console.log(JSON.stringify(report, null, 2));
