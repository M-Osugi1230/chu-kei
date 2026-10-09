import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve('.');
const artifactDir = path.join(root, 'artifacts');
const checks = [];
const issues = [];
const add = (name, ok, detail = '') => {
  const row = { name, ok: Boolean(ok), detail };
  checks.push(row);
  if (!row.ok) issues.push(row);
};
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const planDate = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

const sync = readJson('operations/site-sync/chukei-insight-v15.json');
const currentRelease = readJson('operations/site-sync/current.json');
const publication = readJson('operations/site-sync/incoming/chukei-insight-v15-publication-date-audit.json');
const changes = readJson('operations/site-sync/incoming/chukei-insight-v15-company-change-history.json');
const publicationSchema = readJson('schemas/publication-date-audit-import-v1.schema.json');
const changeSchema = readJson('schemas/company-change-history-import-v1.schema.json');
const manifest = readJson('site/data/bundle.manifest.json');
const compressed = Buffer.concat(
  manifest.parts.map((part) => fs.readFileSync(path.join(root, 'site', 'data', part.file))),
);
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
const data = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const companyByCode = new Map((data.companies ?? []).map((company) => [String(company.code), company]));

add('public site URL aligned', sync.publicUrl === publication.publicUrl && sync.publicUrl === changes.publicUrl, sync.publicUrl);
add('site release aligned', sync.release === publication.siteRelease && sync.release === changes.siteRelease, sync.release);
add('bundle SHA-256 valid', digest === manifest.sha256, digest);
add('bundle company count matches current release', companyByCode.size === currentRelease.repository.companies, `actual=${companyByCode.size}, expected=${currentRelease.repository.companies}`);
add('publication schema registered', publicationSchema.$id?.includes('publication-date-audit-import-v1'), publicationSchema.$id ?? 'missing');
add('change history schema registered', changeSchema.$id?.includes('company-change-history-import-v1'), changeSchema.$id ?? 'missing');
add('automatic publication update prohibited', publication.automaticUpdateAllowed === false);
add('automatic history update prohibited', changes.automaticUpdateAllowed === false);
add('reported publication total aligned', publication.expectedCounts.total === sync.reportedStatus.detailedBetaCompanies, `${publication.expectedCounts.total}`);
add('reported verified count aligned', publication.expectedCounts.verified === sync.reportedStatus.publicationDateAuditSatisfied, `${publication.expectedCounts.verified}`);
add('reported review count aligned', publication.expectedCounts.underReview === sync.reportedStatus.publicationDateAuditUnderReview, `${publication.expectedCounts.underReview}`);
add('publication counts add to total', publication.expectedCounts.verified + publication.expectedCounts.underReview === publication.expectedCounts.total);
add('reported history count aligned', changes.expectedCount === sync.reportedStatus.companyChangeHistoryRecords, `${changes.expectedCount}`);

const publicationStatuses = new Set(['awaiting_export', 'review_ready', 'approved']);
const historyStatuses = new Set(['awaiting_export', 'review_ready', 'approved']);
add('publication envelope status valid', publicationStatuses.has(publication.status), publication.status);
add('history envelope status valid', historyStatuses.has(changes.status), changes.status);

function validatePublicationRecords() {
  if (publication.status === 'awaiting_export') {
    add('publication awaiting export has no invented records', publication.records.length === 0, `records=${publication.records.length}`);
    return;
  }
  add('publication record count complete', publication.records.length === publication.expectedCounts.total, `records=${publication.records.length}`);
  const codes = new Set();
  let verified = 0;
  let underReview = 0;
  for (const [index, record] of publication.records.entries()) {
    const prefix = `publication[${index}]`;
    add(`${prefix} company exists`, companyByCode.has(String(record.code)), String(record.code));
    add(`${prefix} code unique`, !codes.has(String(record.code)), String(record.code));
    codes.add(String(record.code));
    add(`${prefix} official source URL`, /^https:\/\//.test(String(record.sourceUrl ?? '')), String(record.sourceUrl ?? ''));
    add(`${prefix} extracted date`, isoDate.test(String(record.extractedAt ?? '')), String(record.extractedAt ?? ''));
    add(`${prefix} evidence present`, Array.isArray(record.evidence) && record.evidence.length > 0, `items=${record.evidence?.length ?? 0}`);
    if (record.auditStatus === 'verified') {
      verified += 1;
      add(`${prefix} verified date present`, planDate.test(String(record.candidatePublishedDate ?? '')), String(record.candidatePublishedDate ?? ''));
      add(`${prefix} verified precision`, ['day', 'month', 'year'].includes(record.datePrecision), String(record.datePrecision));
    } else if (record.auditStatus === 'under_review') {
      underReview += 1;
      add(`${prefix} unconfirmed precision`, record.datePrecision === 'unconfirmed' || planDate.test(String(record.candidatePublishedDate ?? '')), String(record.datePrecision));
    } else {
      add(`${prefix} audit status valid`, false, String(record.auditStatus));
    }
    if (publication.status === 'approved') {
      add(`${prefix} approved review`, record.reviewStatus === 'approved' && Boolean(record.reviewer) && isoDate.test(String(record.reviewedAt ?? '')), String(record.reviewStatus));
    }
  }
  add('publication verified count matches', verified === publication.expectedCounts.verified, `actual=${verified}`);
  add('publication under-review count matches', underReview === publication.expectedCounts.underReview, `actual=${underReview}`);
}

function validateChangeRecords() {
  if (changes.status === 'awaiting_export') {
    add('change history awaiting export has no invented records', changes.records.length === 0, `records=${changes.records.length}`);
    return;
  }
  add('change history record count complete', changes.records.length === changes.expectedCount, `records=${changes.records.length}`);
  const ids = new Set();
  for (const [index, record] of changes.records.entries()) {
    const prefix = `change[${index}]`;
    add(`${prefix} id unique`, Boolean(record.changeId) && !ids.has(record.changeId), String(record.changeId ?? ''));
    ids.add(record.changeId);
    add(`${prefix} company exists`, companyByCode.has(String(record.code)), String(record.code));
    add(`${prefix} official source URL`, /^https:\/\//.test(String(record.sourceUrl ?? '')), String(record.sourceUrl ?? ''));
    add(`${prefix} evidence present`, Array.isArray(record.sourceEvidence) && record.sourceEvidence.length > 0, `items=${record.sourceEvidence?.length ?? 0}`);
    add(`${prefix} detected date`, isoDate.test(String(record.detectedAt ?? '')), String(record.detectedAt ?? ''));
    add(`${prefix} meaningful difference`, record.beforeValue !== record.afterValue, `${String(record.beforeValue)} -> ${String(record.afterValue)}`);
    if (changes.status === 'approved') {
      add(`${prefix} approved review`, record.reviewStatus === 'approved' && Boolean(record.reviewer) && isoDate.test(String(record.reviewedAt ?? '')), String(record.reviewStatus));
    }
  }
}

function validatePublicSiteReleaseStatus() {
  const releaseStatusPath = 'site/data/release-status.json';
  add('public site release-status.json exists', fs.existsSync(path.join(root, releaseStatusPath)), releaseStatusPath);
  if (!fs.existsSync(path.join(root, releaseStatusPath))) return;

  const releaseStatus = readJson(releaseStatusPath);
  add('public site release status company count matches current release', releaseStatus.repository?.companies === currentRelease.repository.companies, `actual=${releaseStatus.repository?.companies}, expected=${currentRelease.repository.companies}`);
  add('public site release status release string matches current release', releaseStatus.repository?.release === currentRelease.repository.release, releaseStatus.repository?.release);
  add('public site release status sync status matches current release', releaseStatus.sync?.status === currentRelease.sync.status, releaseStatus.sync?.status);
}

function validatePublicCompanyUniverseSync() {
  const publicPath = 'site/data/company-universe-v1.json';
  const canonicalPath = 'operations/universe/current-universe-v1.json';
  add('public company-universe-v1.json exists', fs.existsSync(path.join(root, publicPath)), publicPath);
  add('canonical current-universe-v1.json exists', fs.existsSync(path.join(root, canonicalPath)), canonicalPath);
  if (!fs.existsSync(path.join(root, publicPath)) || !fs.existsSync(path.join(root, canonicalPath))) return;

  const publicUniverse = readJson(publicPath);
  const canonicalUniverse = readJson(canonicalPath);
  add('public company universe company count matches canonical universe', publicUniverse.companyCount === canonicalUniverse.companyCount, `public=${publicUniverse.companyCount}, canonical=${canonicalUniverse.companyCount}`);
  add('public company universe Prime count matches canonical', publicUniverse.marketCounts?.Prime === canonicalUniverse.marketCounts?.Prime, `public=${publicUniverse.marketCounts?.Prime}, canonical=${canonicalUniverse.marketCounts?.Prime}`);
  add('public company universe Standard count matches canonical', publicUniverse.marketCounts?.Standard === canonicalUniverse.marketCounts?.Standard, `public=${publicUniverse.marketCounts?.Standard}, canonical=${canonicalUniverse.marketCounts?.Standard}`);
  add('public company universe Growth count matches canonical', publicUniverse.marketCounts?.Growth === canonicalUniverse.marketCounts?.Growth, `public=${publicUniverse.marketCounts?.Growth}, canonical=${canonicalUniverse.marketCounts?.Growth}`);
}

function validatePublicPlanDetectionSummarySync() {
  const publicPath = 'site/data/plan-detection-summary-v1.json';
  const canonicalPath = 'operations/plan-detection/registry-v1.json';
  add('public plan-detection-summary-v1.json exists', fs.existsSync(path.join(root, publicPath)), publicPath);
  add('canonical plan detection registry-v1.json exists', fs.existsSync(path.join(root, canonicalPath)), canonicalPath);
  if (!fs.existsSync(path.join(root, publicPath)) || !fs.existsSync(path.join(root, canonicalPath))) return;

  const summary = readJson(publicPath);
  const registry = readJson(canonicalPath);
  add('public plan detection summary company count matches registry', summary.companyCount === registry.companyCount, `summary=${summary.companyCount}, registry=${registry.companyCount}`);
  add('public plan detection summary resolved count matches registry', summary.resolvedCount === registry.resolvedCount, `summary=${summary.resolvedCount}, registry=${registry.resolvedCount}`);
  add('public plan detection summary pending count matches registry not_checked', summary.pendingCount === registry.counts?.not_checked, `summary=${summary.pendingCount}, registry=${registry.counts?.not_checked}`);
  add('public plan detection summary current count matches registry', summary.counts?.current === registry.counts?.current, `summary=${summary.counts?.current}, registry=${registry.counts?.current}`);
  add('public plan detection summary coverage matches registry', summary.detectionCoverage === registry.detectionCoverage, `summary=${summary.detectionCoverage}, registry=${registry.detectionCoverage}`);
}

function validatePublicResearchPrioritySummarySync() {
  const publicPath = 'site/data/research-priority-summary-v1.json';
  const canonicalUniversePath = 'operations/universe/current-universe-v1.json';
  add('public research-priority-summary-v1.json exists', fs.existsSync(path.join(root, publicPath)), publicPath);
  if (!fs.existsSync(path.join(root, publicPath))) return;

  const researchPriority = readJson(publicPath);
  if (fs.existsSync(path.join(root, canonicalUniversePath))) {
    const canonicalUniverse = readJson(canonicalUniversePath);
    add('public research priority summary universe count matches company universe', researchPriority.counts?.universe === canonicalUniverse.companyCount, `summary=${researchPriority.counts?.universe}, universe=${canonicalUniverse.companyCount}`);
  }
  add('public research priority summary bundle count matches current release', researchPriority.counts?.sourceBundleCompanies === currentRelease.repository.companies, `summary=${researchPriority.counts?.sourceBundleCompanies}, release=${currentRelease.repository.companies}`);
  add('public research priority summary plan counts add to universe', (researchPriority.counts?.planResolved ?? 0) + (researchPriority.counts?.planPending ?? 0) === researchPriority.counts?.universe, `resolved+pending=${(researchPriority.counts?.planResolved ?? 0) + (researchPriority.counts?.planPending ?? 0)}, universe=${researchPriority.counts?.universe}`);
}

function validatePublicQualityRebaseSync() {
  const publicPath = 'site/data/quality-rebase-v1.json';
  add('public quality-rebase-v1.json exists', fs.existsSync(path.join(root, publicPath)), publicPath);
  if (!fs.existsSync(path.join(root, publicPath))) return;

  const qualityRebase = readJson(publicPath);
  add('public quality rebase company count matches current release', qualityRebase.counts?.companies === currentRelease.repository.companies, `actual=${qualityRebase.counts?.companies}, expected=${currentRelease.repository.companies}`);
}

function validateBundleCompanyUniverseMembership() {
  const canonicalPath = 'operations/universe/current-universe-v1.json';
  if (!fs.existsSync(path.join(root, canonicalPath))) return;

  const canonicalUniverse = readJson(canonicalPath);
  const universeCodes = new Set((canonicalUniverse.companies ?? []).map((c) => String(c.code)));

  let validMembershipCount = 0;
  for (const code of companyByCode.keys()) {
    if (universeCodes.has(code)) {
      validMembershipCount += 1;
    }
  }
  add('all bundle companies present in canonical company universe', validMembershipCount === companyByCode.size, `valid=${validMembershipCount}, total=${companyByCode.size}`);
}

validatePublicationRecords();
validateChangeRecords();
validatePublicSiteReleaseStatus();
validatePublicCompanyUniverseSync();
validatePublicPlanDetectionSummarySync();
validatePublicResearchPrioritySummarySync();
validatePublicQualityRebaseSync();
validateBundleCompanyUniverseMembership();

const blockers = [];
if (publication.status === 'awaiting_export') blockers.push('詳細β70社の公表日監査レコードが未受領');
if (changes.status === 'awaiting_export') blockers.push('企業別変更履歴14件が未受領');
if (publication.status === 'review_ready') blockers.push('公表日監査レコードの承認レビューが未完了');
if (changes.status === 'review_ready') blockers.push('企業別変更履歴の承認レビューが未完了');

const report = {
  version: 'live-site-sync-v1',
  generatedAt: new Date().toISOString(),
  siteRelease: sync.release,
  publicUrl: sync.publicUrl,
  bundleSha256: manifest.sha256,
  currentCompanyCount: currentRelease.repository.companies,
  publicationImport: {
    status: publication.status,
    expectedCounts: publication.expectedCounts,
    receivedRecords: publication.records.length,
  },
  changeHistoryImport: {
    status: changes.status,
    expectedCount: changes.expectedCount,
    receivedRecords: changes.records.length,
  },
  automaticDataUpdateAllowed: false,
  readyForAuthoritativeDataMerge: publication.status === 'approved' && changes.status === 'approved' && issues.length === 0,
  blockers,
  passed: checks.filter((row) => row.ok).length,
  total: checks.length,
  allContractChecksPassed: issues.length === 0,
  checks,
  issues,
};

fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, 'live-site-sync-v15-report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const row of checks) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? `: ${row.detail}` : ''}`);
console.log(`\n${report.passed}/${report.total} contract checks passed`);
console.log(`Authoritative merge ready: ${report.readyForAuthoritativeDataMerge}`);
if (blockers.length) console.log(`Pending: ${blockers.join(' / ')}`);
process.exit(report.allContractChecksPassed ? 0 : 1);
