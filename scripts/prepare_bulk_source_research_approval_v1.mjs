import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const CONFIG_PATH = path.resolve(
  process.env.SOURCE_RESEARCH_BULK_APPROVAL_CONFIG
    || 'operations/source-research/source-research-bulk-approval.json',
);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function readBundle() {
  const manifest = readJson(path.join(DATA_DIR, 'bundle.manifest.json'));
  const compressed = Buffer.concat(
    manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))),
  );
  if (crypto.createHash('sha256').update(compressed).digest('hex') !== manifest.sha256) {
    throw new Error('Bundle SHA-256 mismatch');
  }
  return JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
}

function pageFromMetric(value) {
  return Number(String(value || '').match(/公式PDF p\.(\d+)/)?.[1]) || null;
}

function safeMetric(value, label) {
  const page = pageFromMetric(value);
  return page
    ? `公式PDF p.${page}で${label}に関する数値または方針を確認。対象年度・単位・実績／目標の区分は原文を参照する。`
    : `固定の中期${label}は当該公式資料の抽出範囲で確認できない。`;
}

function sanitizeRecord(candidate) {
  const source = candidate.record || {};
  const document = candidate.document || {};
  const themes = [...new Set(source.themes || [])].slice(0, 6);
  const evidenceRefs = [...new Set(source.evidenceRefs || [])]
    .filter(ref => /公式PDF p\.\d+/.test(String(ref)))
    .slice(0, 3);
  if (evidenceRefs.length < 2) throw new Error(`${candidate.code}: insufficient page evidence`);
  const disclosed = source.progressAssessment?.status === 'not_disclosed';
  const progressAssessment = disclosed
    ? {
        status: 'not_disclosed',
        reason: '当該JPX公式開示資料の抽出範囲では固定中期財務目標を確認できないため、推計値や架空の進捗率を補完しない。',
        sourceRef: evidenceRefs[0],
      }
    : {
        status: 'not_comparable',
        reason: 'JPX公式開示資料で計画・数値・方針を確認したが、自動抽出では目標と実績の同一定義・同一単位・同一企業範囲を最終確認できないため、単純な進捗率を作成しない。',
        sourceRef: evidenceRefs[0],
      };
  const themeText = themes.length ? themes.join('、') : '事業戦略';
  return {
    code: String(candidate.code),
    name: candidate.name,
    category: `${candidate.industry || '業種未確認'}/JPX公式開示資料`,
    sourceUrl: document.url || source.sourceUrl,
    document: document.title || source.document,
    period: '当該公式開示資料の対象期間',
    planPublishedDate: document.date || source.planPublishedDate,
    themes,
    summary: `JPXの企業コード別公式開示資料では、${themeText}を主要論点として示す。数値・施策はページ証跡とともに登録し、目標・実績・会社予想を区別して確認する。`,
    revenue: safeMetric(source.revenue, '売上高・売上収益'),
    profit: safeMetric(source.profit, '利益'),
    margin: safeMetric(source.margin, '収益性・資本効率'),
    capital: safeMetric(source.capital, '投資・資本配分'),
    returnPolicy: safeMetric(source.returnPolicy, '株主還元'),
    highlights: [
      `${document.title || source.document}を${document.date || source.planPublishedDate}に公表した。`,
      `公式資料では${themes.slice(0, 3).join('、') || '事業戦略'}を主要テーマとして確認した。`,
      `${evidenceRefs.length}ページの一次証跡を登録し、原文へ直接遷移できる。`,
    ],
    warnings: [
      '自動抽出した数値を目標値・確定実績・会社予想へ自動分類せず、原文の対象年度・単位・連結範囲を優先する。',
      '後発の計画改定や決算更新がある場合は最新の公式開示を優先し、古い数値を最新目標として扱わない。',
    ],
    evidenceRefs,
    flags: { ...(source.flags || {}), progress: false },
    progressAssessment,
  };
}

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'source-research-bulk-approval-v1') {
  throw new Error(`Unsupported bulk approval schema: ${config.schemaVersion}`);
}
if (config.explicitApproval !== true) throw new Error('explicitApproval=true is required');
if (config.automaticSelectionAllowed !== false) {
  throw new Error('automaticSelectionAllowed must be false');
}
if (!config.proposalPath || !config.approvedProposalSha256) {
  throw new Error('proposalPath and approvedProposalSha256 are required');
}
if (!config.structuredBatchId || !config.structuredConfigPath) {
  throw new Error('structuredBatchId and structuredConfigPath are required');
}

const proposalPath = path.resolve(config.proposalPath);
const proposal = readJson(proposalPath);
if (proposal.schemaVersion !== 'source-research-bulk-proposal-v1') {
  throw new Error(`Unsupported proposal schema: ${proposal.schemaVersion}`);
}
const computedProposalSha = sha256(proposal.identity);
if (proposal.proposalSha256 !== computedProposalSha) {
  throw new Error('Proposal identity hash is invalid');
}
if (proposal.proposalSha256 !== config.approvedProposalSha256) {
  throw new Error('Approved proposal SHA-256 does not match');
}
if (proposal.automaticApproval !== false || proposal.automaticProductionPromotion !== false) {
  throw new Error('Proposal must explicitly prohibit automatic approval and production promotion');
}

const candidatePath = path.resolve(proposal.candidatePath);
const candidates = readJson(candidatePath);
const candidateByCode = new Map((candidates.results || []).map(row => [String(row.code), row]));
const codes = proposal.proposedCodes.map(String);
if (!codes.length) throw new Error('Approved proposal contains no codes');
if (Number.isInteger(config.maximumApprovedCount) && codes.length > config.maximumApprovedCount) {
  throw new Error(`Proposal exceeds maximumApprovedCount: ${codes.length}`);
}

const bundle = readBundle();
const structuredBefore = bundle.companies.filter(company => ['core', 'detailed_extracted'].includes(company.stage)).length;
if (Number.isInteger(config.expectedStructuredBefore) && structuredBefore !== config.expectedStructuredBefore) {
  throw new Error(`Structured count mismatch: ${structuredBefore} !== ${config.expectedStructuredBefore}`);
}
const currentStages = new Map(bundle.companies.map(company => [String(company.code), company.stage]));
const records = codes.map(code => {
  const candidate = candidateByCode.get(code);
  if (!candidate) throw new Error(`${code}: candidate missing`);
  if (candidate.status !== 'eligible') throw new Error(`${code}: candidate is not eligible`);
  if (candidate.identityMatch !== true) throw new Error(`${code}: identity mismatch`);
  if (currentStages.get(code) !== 'jpx_indexed') throw new Error(`${code}: expected jpx_indexed, got ${currentStages.get(code)}`);
  return sanitizeRecord(candidate);
});

const targetStructuredCount = structuredBefore + records.length;
const structuredConfig = {
  schemaVersion: 'structured-expansion-batch-config-v2',
  batchId: config.structuredBatchId,
  patchPrefix: config.patchPrefix || config.structuredBatchId.replace('structured-expansion-', ''),
  runRequested: true,
  dateTag: config.dateTag,
  lastVerifiedDate: config.lastVerifiedDate,
  createdAtBase: config.createdAtBase,
  reviewedAtBase: config.reviewedAtBase,
  targetStructuredCount,
  expectedCompanyCount: 1200,
  expectedSourceConfirmed: targetStructuredCount,
  fromStage: 'jpx_indexed',
  targetStage: 'detailed_extracted',
  sourceResearchBulkApproval: {
    proposalPath: path.relative(ROOT, proposalPath),
    proposalSha256: proposal.proposalSha256,
    candidatePath: path.relative(ROOT, candidatePath),
    explicitApproval: true,
    automaticSelectionAllowed: false,
    approvedCount: records.length,
  },
  records,
};
writeJson(path.resolve(config.structuredConfigPath), structuredConfig);
writeJson(
  path.join(ROOT, 'operations', 'source-research', `${config.approvalId}-report.json`),
  {
    schemaVersion: 'source-research-bulk-approval-report-v1',
    approvalId: config.approvalId,
    proposalSha256: proposal.proposalSha256,
    explicitApproval: true,
    automaticSelectionAllowed: false,
    structuredBefore,
    approvedCount: records.length,
    targetStructuredCount,
    approvedCodes: codes,
    structuredConfigPath: config.structuredConfigPath,
  },
);
console.log(JSON.stringify({
  approvalId: config.approvalId,
  approvedCount: records.length,
  structuredBefore,
  targetStructuredCount,
  structuredConfigPath: config.structuredConfigPath,
}, null, 2));
