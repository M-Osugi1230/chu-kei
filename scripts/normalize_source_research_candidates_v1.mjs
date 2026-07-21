import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const CONFIG_PATH = path.resolve(
  process.env.SOURCE_RESEARCH_CONFIG
    || 'operations/source-research/source-research-batch-config.json',
);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const config = readJson(CONFIG_PATH);
if (config.schemaVersion !== 'source-research-batch-v1') {
  throw new Error(`Unsupported research config schema: ${config.schemaVersion}`);
}
const candidatePath = path.resolve(
  config.outputPath || `operations/source-research/${config.batchId}-candidates.json`,
);
const report = readJson(candidatePath);
if (report.schemaVersion !== 'source-research-candidates-v1') {
  throw new Error(`Unsupported candidate schema: ${report.schemaVersion}`);
}

let connectedDowngrades = 0;
let identityDowngrades = 0;
for (const candidate of report.results || []) {
  if (candidate.record?.progressAssessment?.status === 'connected') {
    candidate.record.progressAssessment = {
      status: 'not_comparable',
      reason: '自動抽出では目標と実績の同一定義・同一単位・同一企業範囲を最終確認できないため、明示的な個別レビューが完了するまで単純な進捗率を作成しない。',
      sourceRef: candidate.record.progressAssessment.sourceRef,
    };
    connectedDowngrades += 1;
  }
  if (candidate.status === 'eligible' && candidate.identityMatch !== true) {
    candidate.status = 'needs_review';
    candidate.reviewReason = 'JPX企業コード経由で取得した資料だが、PDF本文内の企業名または証券コード一致を確認できない。';
    identityDowngrades += 1;
  }
  if (candidate.record?.flags) candidate.record.flags.progress = false;
}

const eligible = (report.results || []).filter(row => row.status === 'eligible');
report.eligibleCount = eligible.length;
report.needsReviewCount = (report.results || []).filter(row => row.status === 'needs_review').length;
report.failureCount = (report.results || []).filter(
  row => !['eligible', 'needs_review'].includes(row.status),
).length;
report.eligibleCodes = eligible.map(row => String(row.code));
report.safetyNormalization = {
  automaticConnectedStatusAllowed: false,
  connectedDowngrades,
  identityDowngrades,
};
writeJson(candidatePath, report);

console.log(JSON.stringify({
  candidatePath: path.relative(ROOT, candidatePath),
  eligibleCount: report.eligibleCount,
  needsReviewCount: report.needsReviewCount,
  connectedDowngrades,
  identityDowngrades,
}, null, 2));
