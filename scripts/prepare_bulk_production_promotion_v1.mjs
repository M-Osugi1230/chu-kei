import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const CONFIG_PATH = path.resolve(
  process.env.BULK_PRODUCTION_PROMOTION_CONFIG
    || 'operations/production-quality/production-bulk-promotion-approval.json',
);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sorted = values => [...values].map(String).sort((a, b) => a.localeCompare(b, 'ja'));
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'production-bulk-promotion-approval-v1') {
  throw new Error(`Unsupported config schema: ${config.schemaVersion}`);
}
if (config.explicitApproval !== true) throw new Error('explicitApproval=true is required');
if (config.automaticSelectionAllowed !== false) {
  throw new Error('automaticSelectionAllowed must be false');
}
if (!config.productionBatchId || !config.targetCoreCount) {
  throw new Error('productionBatchId and targetCoreCount are required');
}

const reportPathValues = Array.isArray(config.sourceResearchApprovalReportPaths)
  ? config.sourceResearchApprovalReportPaths
  : [config.sourceResearchApprovalReportPath].filter(Boolean);
const expectedProposalHashes = Array.isArray(config.approvedProposalSha256s)
  ? config.approvedProposalSha256s
  : [config.approvedProposalSha256].filter(Boolean);
if (!reportPathValues.length || reportPathValues.length !== expectedProposalHashes.length) {
  throw new Error('Approval report paths and proposal SHA-256 values must be non-empty and have equal length');
}

const approvalReports = reportPathValues.map((relativePath, index) => {
  const reportPath = path.resolve(relativePath);
  const report = readJson(reportPath);
  if (report.schemaVersion !== 'source-research-bulk-approval-report-v1') {
    throw new Error(`Unsupported approval report: ${report.schemaVersion}`);
  }
  if (report.explicitApproval !== true || report.automaticSelectionAllowed !== false) {
    throw new Error(`Source research approval report does not preserve explicit approval policy: ${relativePath}`);
  }
  if (report.proposalSha256 !== expectedProposalHashes[index]) {
    throw new Error(`Approved proposal SHA-256 mismatch: ${relativePath}`);
  }
  const codes = sorted(report.approvedCodes || []);
  if (!codes.length || codes.length !== report.approvedCount) {
    throw new Error(`Approved code count mismatch: ${relativePath}`);
  }
  return {
    path: path.relative(ROOT, reportPath),
    proposalSha256: report.proposalSha256,
    approvalId: report.approvalId,
    approvedCount: report.approvedCount,
    codes,
  };
});

const codeOrigins = new Map();
for (const report of approvalReports) {
  for (const code of report.codes) {
    const origins = codeOrigins.get(code) || [];
    origins.push(report.path);
    codeOrigins.set(code, origins);
  }
}
const duplicates = [...codeOrigins.entries()].filter(([, origins]) => origins.length > 1);
if (duplicates.length) {
  throw new Error(`Approval reports contain duplicate codes: ${duplicates.map(([code]) => code).join(',')}`);
}
const codes = sorted(codeOrigins.keys());
if (Number.isInteger(config.expectedApprovedCount) && codes.length !== config.expectedApprovedCount) {
  throw new Error(`Expected ${config.expectedApprovedCount} approved codes, got ${codes.length}`);
}

const readinessPath = path.join(ROOT, 'operations', 'production-quality', 'production-readiness-v1.json');
const readiness = readJson(readinessPath);
if (config.expectedBundleSha256 && readiness.bundleSha256 !== config.expectedBundleSha256) {
  throw new Error(`Readiness bundle SHA-256 mismatch: ${readiness.bundleSha256} !== ${config.expectedBundleSha256}`);
}
if (readiness.currentProduction !== config.expectedCoreBefore) {
  throw new Error(`Core count mismatch: ${readiness.currentProduction} !== ${config.expectedCoreBefore}`);
}
if (config.targetCoreCount !== config.expectedCoreBefore + codes.length) {
  throw new Error('targetCoreCount must equal expectedCoreBefore plus approved code count');
}
const approvalRequired = sorted(readiness.queues?.approvalRequiredCodes || []);
if (JSON.stringify(approvalRequired) !== JSON.stringify(codes)) {
  const approvedOnly = codes.filter(code => !approvalRequired.includes(code));
  const queueOnly = approvalRequired.filter(code => !codes.includes(code));
  throw new Error(`Approval queue mismatch. approvedOnly=${approvedOnly.join(',')} queueOnly=${queueOnly.join(',')}`);
}
if (readiness.machineReadyNotProduction !== codes.length) {
  throw new Error(`machineReadyNotProduction mismatch: ${readiness.machineReadyNotProduction} !== ${codes.length}`);
}

const approvalIdentity = {
  schemaVersion: 'production-bulk-promotion-aggregate-identity-v1',
  readinessBundleSha256: readiness.bundleSha256,
  expectedCoreBefore: config.expectedCoreBefore,
  targetCoreCount: config.targetCoreCount,
  reports: approvalReports.map(report => ({
    path: report.path,
    proposalSha256: report.proposalSha256,
    approvalId: report.approvalId,
    approvedCount: report.approvedCount,
  })),
  codes,
};
const aggregateApprovalSha256 = sha256(approvalIdentity);

const batchPath = path.join(
  ROOT,
  'operations',
  'production-quality',
  `${config.productionBatchId}.json`,
);
writeJson(batchPath, {
  schemaVersion: 'production-promotion-batch-v1',
  batchId: config.productionBatchId,
  explicitApproval: true,
  automaticSelectionAllowed: false,
  codes,
  targetCoreCount: config.targetCoreCount,
  primaryAuthor: config.primaryAuthor || 'production-quality-agent',
  primaryReviewer: config.primaryReviewer || 'production-quality-review',
  independentAuthor: config.independentAuthor || 'independent-release-agent',
  independentReviewer: config.independentReviewer || 'independent-release-review',
  approvalDate: config.approvalDate,
  sourceResearchBulkApproval: {
    approvalReports: approvalReports.map(report => ({
      path: report.path,
      proposalSha256: report.proposalSha256,
      approvalId: report.approvalId,
      approvedCount: report.approvedCount,
    })),
    aggregateApprovalSha256,
    approvedCount: codes.length,
  },
});
writeJson(
  path.join(ROOT, 'operations', 'production-quality', 'production-promotion-selection.json'),
  {
    schemaVersion: 'production-promotion-run-v1',
    configPath: path.relative(ROOT, batchPath),
  },
);
writeJson(
  path.join(ROOT, 'operations', 'production-quality', `${config.approvalId}-report.json`),
  {
    schemaVersion: 'production-bulk-promotion-approval-report-v1',
    approvalId: config.approvalId,
    aggregateApprovalSha256,
    approvalIdentity,
    explicitApproval: true,
    automaticSelectionAllowed: false,
    expectedCoreBefore: config.expectedCoreBefore,
    approvedCount: codes.length,
    targetCoreCount: config.targetCoreCount,
    productionBatchPath: path.relative(ROOT, batchPath),
  },
);
console.log(JSON.stringify({
  approvalId: config.approvalId,
  aggregateApprovalSha256,
  sourceApprovalReports: approvalReports.length,
  approvedCount: codes.length,
  expectedCoreBefore: config.expectedCoreBefore,
  targetCoreCount: config.targetCoreCount,
  productionBatchPath: path.relative(ROOT, batchPath),
}, null, 2));
