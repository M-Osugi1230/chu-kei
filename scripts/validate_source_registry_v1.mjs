import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import net from 'node:net';
import { countPrimaryEvidenceReferences } from './lib/evidence_reference_v1.mjs';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'source-registry-report-v1.json');
const MILESTONE_PATH = path.join(ROOT, 'operations', 'quality', 'coverage-milestone-v1.json');
const PRODUCTION_TARGET_PATH = path.join(ROOT, 'operations', 'production-quality', 'production-quality-target-v1.json');
const checks = [];
const issues = [];
const warnings = [];

const milestone = fs.existsSync(MILESTONE_PATH)
  ? JSON.parse(fs.readFileSync(MILESTONE_PATH, 'utf8'))
  : { schemaVersion: 'coverage-milestone-v1', minimumSourceConfirmed: 200 };
const productionTarget = fs.existsSync(PRODUCTION_TARGET_PATH)
  ? JSON.parse(fs.readFileSync(PRODUCTION_TARGET_PATH, 'utf8'))
  : { minimumPageEvidenceRefs: 2 };

if (milestone.schemaVersion !== 'coverage-milestone-v1') {
  throw new Error(`Unsupported coverage milestone schema: ${milestone.schemaVersion}`);
}

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) issues.push({ name, detail });
}
function warn(type, detail, records = []) {
  warnings.push({ type, detail, records });
}
function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
  const buffers = manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file)));
  const compressed = Buffer.concat(buffers);
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return JSON.parse(zlib.gunzipSync(compressed));
}
function isPrivateHost(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
  const ipVersion = net.isIP(hostname);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const [a, b] = hostname.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:');
}
function parseSource(company) {
  try {
    const url = new URL(company.sourceUrl);
    return { company, url, error: null };
  } catch (error) {
    return { company, url: null, error: error.message };
  }
}

let data = { companies: [] };
try {
  data = readBundle();
  check('source bundle readable', true);
} catch (error) {
  check('source bundle readable', false, error.message);
}

const companies = Array.isArray(data.companies) ? data.companies : [];
const sourceConfirmed = companies.filter(company => company.stage !== 'jpx_indexed');
const parsed = sourceConfirmed.map(parseSource);
const valid = parsed.filter(record => record.url);
const invalid = parsed.filter(record => !record.url);

check(
  `source-confirmed company minimum ${milestone.minimumSourceConfirmed}`,
  sourceConfirmed.length >= milestone.minimumSourceConfirmed,
  `actual=${sourceConfirmed.length}`,
);
check('source URL present', sourceConfirmed.every(company => typeof company.sourceUrl === 'string' && company.sourceUrl.trim()), `missing=${sourceConfirmed.filter(company => !company.sourceUrl).length}`);
check('source URL parseable', invalid.length === 0, invalid.map(record => `${record.company.code}:${record.error}`).join(', '));
check('source URL HTTPS', valid.every(record => record.url.protocol === 'https:'), valid.filter(record => record.url.protocol !== 'https:').map(record => `${record.company.code}:${record.url.href}`).join(', '));
check('source URL hostname present', valid.every(record => record.url.hostname), '');
check('source URL has no credentials', valid.every(record => !record.url.username && !record.url.password), valid.filter(record => record.url.username || record.url.password).map(record => record.company.code).join(', '));
check('source URL excludes private hosts', valid.every(record => !isPrivateHost(record.url.hostname)), valid.filter(record => isPrivateHost(record.url.hostname)).map(record => `${record.company.code}:${record.url.hostname}`).join(', '));
check('source verification date present', sourceConfirmed.every(company => /^\d{4}-\d{2}-\d{2}$/.test(company.lastVerifiedDate || '')), `missing-or-invalid=${sourceConfirmed.filter(company => !/^\d{4}-\d{2}-\d{2}$/.test(company.lastVerifiedDate || '')).length}`);
check('source document label present', sourceConfirmed.every(company => typeof company.document === 'string' && company.document.trim()), `missing=${sourceConfirmed.filter(company => !company.document).length}`);

const urlGroups = new Map();
for (const record of valid) {
  const normalized = record.url.href;
  if (!urlGroups.has(normalized)) urlGroups.set(normalized, []);
  urlGroups.get(normalized).push(record.company);
}
const duplicates = [...urlGroups.entries()].filter(([, records]) => records.length > 1);
for (const [url, records] of duplicates) {
  warn('duplicate_url', url, records.map(company => ({ code: company.code, name: company.name, stage: company.stage })));
}
for (const record of valid.filter(record => record.url.hash)) {
  warn('fragment_url', record.url.href, [{ code: record.company.code, name: record.company.name }]);
}
for (const record of valid.filter(record => record.url.searchParams.size > 8)) {
  warn('complex_query', record.url.href, [{ code: record.company.code, name: record.company.name }]);
}

const hostCounts = {};
for (const record of valid) hostCounts[record.url.hostname] = (hostCounts[record.url.hostname] || 0) + 1;
const stageSummary = {};
for (const stage of ['core', 'detailed_extracted', 'source_indexed']) {
  const rows = sourceConfirmed.filter(company => company.stage === stage);
  stageSummary[stage] = {
    companies: rows.length,
    publicationDate: rows.filter(company => company.planPublishedDate).length,
    pageEvidence: rows.filter(company => countPrimaryEvidenceReferences(company.evidenceRefs) >= productionTarget.minimumPageEvidenceRefs).length,
    verifiedDate: rows.filter(company => /^\d{4}-\d{2}-\d{2}$/.test(company.lastVerifiedDate || '')).length,
  };
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const report = {
  version: 'source-audit-v1.1',
  checkedAt: new Date().toISOString(),
  milestone,
  minimumPageEvidenceRefs: productionTarget.minimumPageEvidenceRefs,
  summary: {
    sourceConfirmedCompanies: sourceConfirmed.length,
    uniqueUrls: urlGroups.size,
    uniqueHosts: Object.keys(hostCounts).length,
    duplicateUrlGroups: duplicates.length,
    warningCount: warnings.length,
    issueCount: issues.length,
  },
  stageSummary,
  hostCounts: Object.entries(hostCounts).sort((a, b) => b[1] - a[1]).map(([host, count]) => ({ host, count })),
  checks,
  warnings,
  issues,
};
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Report: ${REPORT_PATH}`);
process.exit(issues.length === 0 ? 0 : 1);
