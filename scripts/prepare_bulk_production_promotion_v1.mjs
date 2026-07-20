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

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'production-bulk-promotion-approval-v1') {
  throw new Error(`Unsupported config schema: ${config.schemaVersion}`);
}
if (config.explicitApproval !== true) throw new Error('explicitApproval=true is required');
if (config.automaticSelectionAllowed !== false) {
  throw new Error('automaticSelectionAllowed must be false');
}
if (!config.sourceResearchApprovalReportPath || !config.approvedProposalSha256) {
  throw new Error('sourceResearchApprovalReportPath and approvedProposalSha256 are required');
}
if (!config.productionBatchId || !config.targetCoreCount) {
  throw new Error('productionBatchId and targetCoreCount are required');
}

const approvalReportPath = path.resolve(config.sourceResearchApprovalReportPath);
const approvalReport = readJson(approvalReportPath);
if (approvalReport.schemaVersion !== 'source-research-bulk-approval-report-v1') {
  throw new Error(`Unsupported approval report: ${approvalReport.schemaVersion}`);
}
if (approvalReport.explicitApproval !== true || approvalReport.automaticSelectionAllowed !== false) {
  throw new Error('Source research approval report does not preserve explicit approval policy');
}
if (approvalReport.proposalSha256 !== config.approvedProposalSha256) {
  throw new Error('Approved proposal SHA-256 mismatch');
}
const codes = sorted(approvalReport.approvedCodes || []);
if (!codes.length || codes.length !== approvalReport.approvedCount) {
  throw new Error('Approved code count mismatch');
}
if (Number.isInteger(config.expectedApprovedCount) && codes.length !== config.expectedApprovedCount) {
  throw new Error(`Expected ${config.expectedApprovedCount} approved codes, got ${codes.length}`);
}

const readinessPath = path.join(ROOT, 'operations', 'production-quality', 'production-readiness-v1.json');
const readiness = readJson(readinessPath);
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
    approvalReportPath: path.relative(ROOT, approvalReportPath),
    proposalSha256: approvalReport.proposalSha256,
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
    proposalSha256: approvalReport.proposalSha256,
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
  approvedCount: codes.length,
  expectedCoreBefore: config.expectedCoreBefore,
  targetCoreCount: config.targetCoreCount,
  productionBatchPath: path.relative(ROOT, batchPath),
}, null, 2));
