import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const sourceNormalizationMarker = path.join(ROOT, 'operations', 'source-coverage', 'normalize-source-indexed.json');
const companyCoverageMarkers = [
  path.join(ROOT, 'operations', 'coverage-growth', 'run-company-coverage.json'),
  path.join(ROOT, 'operations', 'coverage-growth', 'run-1000.json'),
];
const patchDir = path.join(ROOT, 'operations', 'patches');
const structuredRunMarker = path.join(patchDir, 'run-structured-expansion.json');
const productionQualityDir = path.join(ROOT, 'operations', 'production-quality');
const progressRunMarker = path.join(productionQualityDir, 'progress-connection-selection.json');
const sourceResearchDir = path.join(ROOT, 'operations', 'source-research');
const jpxOutput = path.join(ROOT, 'operations', 'research', 'jpx-listed-companies-latest.json');

const runNode = (script, env = {}) => execFileSync(process.execPath, [script], {
  cwd: ROOT,
  env: { ...process.env, ...env },
  stdio: 'inherit',
});
const runCommand = (command, args, env = {}) => execFileSync(command, args, {
  cwd: ROOT,
  env: { ...process.env, ...env },
  stdio: 'inherit',
});
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const firstExisting = paths => paths.find(file => fs.existsSync(file)) || null;
const isApplyWorkflow = process.env.GITHUB_WORKFLOW === 'Apply Structured Source of Truth';

function findRequestedConfig(directory, pattern) {
  if (!fs.existsSync(directory)) return null;
  const files = fs.readdirSync(directory)
    .filter(file => pattern.test(file))
    .sort((a, b) => {
      const aNumber = Number(a.match(/\d+/)?.[0] || 0);
      const bNumber = Number(b.match(/\d+/)?.[0] || 0);
      return bNumber - aNumber || b.localeCompare(a);
    });
  for (const file of files) {
    const filePath = path.join(directory, file);
    const config = readJson(filePath);
    if (config.runRequested === true) return { filePath, config };
  }
  return null;
}

function consumeRequestedConfig(request, label) {
  if (!request) return;
  const consumed = readJson(request.filePath);
  delete consumed.runRequested;
  writeJson(request.filePath, consumed);
  console.log(`${label} request consumed: ${path.relative(ROOT, request.filePath)}`);
}

const findEmbeddedStructuredRequest = () => findRequestedConfig(patchDir, /^structured-expansion-batch-\d+-config\.json$/);
const findEmbeddedProgressRequest = () => findRequestedConfig(productionQualityDir, /^progress-connection-batch-\d+\.json$/);
const findFinalProductionCompanyRequest = () => findRequestedConfig(productionQualityDir, /^final-production-company-\d+\.json$/);
const findBulkProductionPromotionRequest = () => findRequestedConfig(productionQualityDir, /^production-bulk-promotion-approval-\d+\.json$/);
const findSourceResearchBatchRequest = () => findRequestedConfig(sourceResearchDir, /^source-research-batch-request-\d+\.json$/);
const findSourceResearchRequest = () => findRequestedConfig(sourceResearchDir, /^source-research-batch-\d+-config\.json$/);
const findSourceResearchApprovalRequest = () => findRequestedConfig(sourceResearchDir, /^source-research-approval-\d+\.json$/);
const findSourceResearchProposalRequest = () => findRequestedConfig(sourceResearchDir, /^source-research-proposal-\d+-config\.json$/);
const findSourceResearchRecoveryProposalRequest = () => findRequestedConfig(sourceResearchDir, /^source-research-recovery-proposal-\d+-config\.json$/);
const findSourceResearchBulkApprovalRequest = () => findRequestedConfig(sourceResearchDir, /^source-research-bulk-approval-\d+\.json$/);

const companyCoverageMarker = firstExisting(companyCoverageMarkers);
if (isApplyWorkflow && companyCoverageMarker) {
  const config = readJson(companyCoverageMarker);
  if (config.schemaVersion !== 'company-coverage-run-v1') {
    throw new Error(`Unsupported company coverage marker: ${config.schemaVersion}`);
  }
  console.log(`Expanding listed-company coverage to ${config.targetCompanyTotal} companies.`);
  runCommand('python3', ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'xlrd==2.0.1', 'openpyxl==3.1.5']);
  runCommand('python3', [
    'scripts/fetch_jpx_listed_companies_v1.py',
    '--output', path.relative(ROOT, jpxOutput),
    '--source-page', config.sourcePage,
  ]);
  runNode('scripts/apply_company_coverage_1000_v1.mjs', {
    TARGET_COMPANY_TOTAL: String(config.targetCompanyTotal),
    COVERAGE_VERIFIED_DATE: String(config.verifiedDate),
    COMPANY_COVERAGE_BUNDLE_BUDGET: String(config.bundleBudgetBytes || 262144),
  });
  fs.rmSync(companyCoverageMarker);
  console.log(`Company coverage marker consumed: ${path.relative(ROOT, companyCoverageMarker)}`);
}

if (isApplyWorkflow && fs.existsSync(sourceNormalizationMarker)) {
  runNode('scripts/normalize_source_indexed_coverage_v1.mjs');
  fs.rmSync(sourceNormalizationMarker);
  console.log('Source-indexed normalization marker consumed.');
}

if (isApplyWorkflow) {
  const batchRequest = findSourceResearchBatchRequest();
  if (batchRequest) {
    runNode('scripts/prepare_source_research_batch_v1.mjs', {
      SOURCE_RESEARCH_BATCH_REQUEST: path.relative(ROOT, batchRequest.filePath),
    });
    consumeRequestedConfig(batchRequest, 'Source research batch preparation');
  }

  const sourceResearch = findSourceResearchRequest();
  if (sourceResearch) {
    runCommand('python3', [
      'scripts/research_jpx_documents_v1.py',
      '--config', path.relative(ROOT, sourceResearch.filePath),
    ]);
    runNode('scripts/normalize_source_research_candidates_v1.mjs', {
      SOURCE_RESEARCH_CONFIG: path.relative(ROOT, sourceResearch.filePath),
    });
    consumeRequestedConfig(sourceResearch, 'Source research');
  }

  const proposalRequest = findSourceResearchProposalRequest();
  if (proposalRequest) {
    runNode('scripts/generate_bulk_source_research_proposal_v1.mjs', {
      SOURCE_RESEARCH_PROPOSAL_CONFIG: path.relative(ROOT, proposalRequest.filePath),
    });
    consumeRequestedConfig(proposalRequest, 'Source research proposal');
  }

  const recoveryProposalRequest = findSourceResearchRecoveryProposalRequest();
  if (recoveryProposalRequest) {
    runNode('scripts/generate_source_research_recovery_proposal_v1.mjs', {
      SOURCE_RESEARCH_RECOVERY_PROPOSAL_CONFIG: path.relative(ROOT, recoveryProposalRequest.filePath),
    });
    consumeRequestedConfig(recoveryProposalRequest, 'Source research recovery proposal');
  }

  const bulkApproval = findSourceResearchBulkApprovalRequest();
  if (bulkApproval) {
    runNode('scripts/prepare_bulk_source_research_approval_v1.mjs', {
      SOURCE_RESEARCH_BULK_APPROVAL_CONFIG: path.relative(ROOT, bulkApproval.filePath),
    });
    consumeRequestedConfig(bulkApproval, 'Source research bulk approval');
  }

  const sourceApproval = findSourceResearchApprovalRequest();
  if (sourceApproval) {
    runNode('scripts/prepare_structured_candidate_approval_v1.mjs', {
      SOURCE_RESEARCH_APPROVAL_CONFIG: path.relative(ROOT, sourceApproval.filePath),
    });
    consumeRequestedConfig(sourceApproval, 'Source research approval');
  }
}

let embeddedStructured = null;
if (isApplyWorkflow && !fs.existsSync(structuredRunMarker)) {
  embeddedStructured = findEmbeddedStructuredRequest();
  if (embeddedStructured) {
    writeJson(structuredRunMarker, {
      schemaVersion: 'structured-expansion-run-v1',
      configPath: path.relative(ROOT, embeddedStructured.filePath),
    });
  }
}
runNode('scripts/apply_structured_expansion_ci_v1.mjs');
if (embeddedStructured) consumeRequestedConfig(embeddedStructured, 'Embedded structured expansion');
runNode('scripts/apply_structured_correction_v1.mjs');
if (isApplyWorkflow) {
  runNode('scripts/apply_core_evidence_repair_v1.mjs');
  const finalProductionCompany = findFinalProductionCompanyRequest();
  if (finalProductionCompany) {
    runNode('scripts/prepare_final_production_company_v1.mjs', {
      FINAL_PRODUCTION_COMPANY_CONFIG: path.relative(ROOT, finalProductionCompany.filePath),
    });
    consumeRequestedConfig(finalProductionCompany, 'Final production company');
  }
  const embeddedProgress = findEmbeddedProgressRequest();
  if (embeddedProgress) {
    if (fs.existsSync(progressRunMarker)) throw new Error('A legacy progress marker already exists; refusing to overwrite it.');
    writeJson(progressRunMarker, {
      schemaVersion: 'progress-connection-run-v1',
      configPath: path.relative(ROOT, embeddedProgress.filePath),
    });
  }
  runNode('scripts/apply_progress_connection_batch_v1.mjs');
  if (embeddedProgress) consumeRequestedConfig(embeddedProgress, 'Embedded progress connection');
}
runNode('scripts/normalize_progress_assessment_flags_v1.mjs');
runNode('scripts/normalize_structured_summary_identity_v1.mjs');
runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/normalize_bundle_contract_v1.mjs');
runNode('scripts/build_frontend_data_shards_v1.mjs');
runNode('scripts/sync_production_approval_metadata_v1.mjs');
runNode('scripts/audit_production_readiness_v1.mjs');
if (isApplyWorkflow) {
  const bulkProductionPromotion = findBulkProductionPromotionRequest();
  if (bulkProductionPromotion) {
    runNode('scripts/prepare_bulk_production_promotion_v1.mjs', {
      BULK_PRODUCTION_PROMOTION_CONFIG: path.relative(ROOT, bulkProductionPromotion.filePath),
    });
    consumeRequestedConfig(bulkProductionPromotion, 'Bulk production promotion approval');
  }
  runNode('scripts/apply_production_promotion_v1.mjs');
  runNode('scripts/apply_core_approval_batch_v1.mjs');
}
runNode('scripts/sync_production_approval_metadata_v1.mjs');
runNode('scripts/audit_production_readiness_v1.mjs');
runNode('scripts/analyze_production_scale_candidates_v1.mjs');
runNode('scripts/generate_progress_connection_queue_v1.mjs');
runNode('scripts/extract_progress_batch_context_v1.mjs');
