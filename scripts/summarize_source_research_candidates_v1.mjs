import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const SOURCE_DIR = path.join(ROOT, 'operations', 'source-research');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

if (!fs.existsSync(SOURCE_DIR)) process.exit(0);
const candidateFiles = fs.readdirSync(SOURCE_DIR)
  .filter(file => /^source-research-batch-\d+-candidates\.json$/.test(file))
  .sort();

for (const file of candidateFiles) {
  const inputPath = path.join(SOURCE_DIR, file);
  const report = readJson(inputPath);
  if (report.schemaVersion !== 'source-research-candidates-v1') continue;
  const rows = (report.results || []).map(candidate => {
    const document = candidate.document || {};
    const record = candidate.record || {};
    const title = String(document.title || '');
    const isPlanDocument = /中期|中長期|長期経営|事業計画及び成長可能性|事業計画と成長可能性|経営戦略|成長戦略/.test(title);
    const isEarningsOnly = /決算説明|決算補足|決算短信/.test(title) && !isPlanDocument;
    const publishedYear = Number(String(document.date || '').slice(0, 4)) || null;
    const recentPlan = Boolean(isPlanDocument && publishedYear && publishedYear >= 2024);
    const evidencePages = (record.evidenceRefs || [])
      .map(value => Number(String(value).match(/p\.(\d+)/)?.[1]))
      .filter(Number.isFinite);
    const distinctEvidencePages = [...new Set(evidencePages)];
    const recommendation = candidate.status === 'eligible'
      && candidate.identityMatch === true
      && recentPlan
      && distinctEvidencePages.length >= 2
      ? 'manual_review_priority'
      : candidate.status === 'eligible'
        ? 'manual_review_required'
        : 'hold';
    return {
      code: String(candidate.code),
      name: candidate.name,
      market: candidate.market,
      industry: candidate.industry,
      status: candidate.status,
      confidence: candidate.confidence ?? null,
      identityMatch: candidate.identityMatch === true,
      documentDate: document.date ?? null,
      documentTitle: document.title ?? null,
      documentUrl: document.url ?? null,
      documentScore: document.score ?? null,
      pageCount: candidate.pageCount ?? null,
      documentCount: candidate.documentCount ?? null,
      isPlanDocument,
      isEarningsOnly,
      recentPlan,
      recommendation,
      themes: record.themes || [],
      evidenceRefs: record.evidenceRefs || [],
      progressAssessment: record.progressAssessment || null,
      metrics: {
        revenue: record.revenue ?? null,
        profit: record.profit ?? null,
        margin: record.margin ?? null,
        capital: record.capital ?? null,
        returnPolicy: record.returnPolicy ?? null,
      },
      failure: candidate.error || candidate.reviewReason || null,
    };
  });
  const outputPath = inputPath.replace(/-candidates\.json$/, '-review-summary.json');
  writeJson(outputPath, {
    schemaVersion: 'source-research-review-summary-v1',
    batchId: report.batchId,
    generatedAt: new Date().toISOString(),
    automaticApproval: false,
    counts: {
      selected: rows.length,
      eligible: rows.filter(row => row.status === 'eligible').length,
      manualReviewPriority: rows.filter(row => row.recommendation === 'manual_review_priority').length,
      manualReviewRequired: rows.filter(row => row.recommendation === 'manual_review_required').length,
      hold: rows.filter(row => row.recommendation === 'hold').length,
      earningsOnly: rows.filter(row => row.isEarningsOnly).length,
    },
    priorityCodes: rows.filter(row => row.recommendation === 'manual_review_priority').map(row => row.code),
    rows,
  });
  console.log(`Source research review summary written: ${path.relative(ROOT, outputPath)}`);
}
