import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { countPrimaryEvidenceReferences } from './lib/evidence_reference_v1.mjs';

const root = path.resolve('site');
const repoRoot = path.resolve('.');
const dataDir = path.join(root, 'data');
const checks = [];
const issues = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  if (!ok) issues.push({ name, detail });
};

const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'bundle.manifest.json'), 'utf8'));
const budget = JSON.parse(fs.readFileSync(path.join(repoRoot, 'operations', 'quality-debt-budget-v1.json'), 'utf8'));
let payload = { companies: [], progress: [] };
try {
  payload = JSON.parse(zlib.gunzipSync(Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(dataDir, part.file))))));
  check('quality source data readable', true);
} catch (error) {
  check('quality source data readable', false, error.message);
}

const companies = payload.companies || [];
const core = companies.filter(company => company.stage === 'core');
const detailed = companies.filter(company => company.stage === 'detailed_extracted');
const structuredReviewable = [...core, ...detailed];
const primaryEvidence = company => countPrimaryEvidenceReferences(company.evidenceRefs) > 0;
const priorityA = detailed.filter(primaryEvidence).length;
const priorityB = detailed.filter(company => !primaryEvidence(company)).length;
const corePublicationGaps = core.filter(company => !company.planPublishedDate).length;
const corePageGaps = core.filter(company => !primaryEvidence(company)).length;
const expectedPublicationMaximum = budget.maximumCounts?.['core.missingPublicationDate'];
const expectedPageMaximum = budget.maximumCounts?.['core.missingPageEvidence'];
const expectedDetailedPageMaximum = budget.maximumCounts?.['detailed.missingPageEvidence'];
const expectedStructuredReviewableMinimum = budget.minimumCounts?.['structured.reviewableCompanies'];

check('quality dashboard HTML exists', fs.existsSync(path.join(root, 'quality.html')));
check('quality dashboard JavaScript exists', fs.existsSync(path.join(root, 'assets/quality.js')));
check('quality dashboard CSS exists', fs.existsSync(path.join(root, 'assets/quality.css')));
check(
  'quality debt budget readable',
  Number.isInteger(expectedPublicationMaximum)
    && Number.isInteger(expectedPageMaximum)
    && Number.isInteger(expectedDetailedPageMaximum)
    && Number.isInteger(expectedStructuredReviewableMinimum),
);
check(
  'structured reviewable company pool does not regress',
  structuredReviewable.length >= expectedStructuredReviewableMinimum,
  `core=${core.length}, detailed=${detailed.length}, total=${structuredReviewable.length}, minimum=${expectedStructuredReviewableMinimum}`,
);
check('priority A and B partition review queue', priorityA + priorityB === detailed.length, `A=${priorityA}, B=${priorityB}`);
check('priority B within detailed evidence debt budget', priorityB <= expectedDetailedPageMaximum, `actual=${priorityB}, maximum=${expectedDetailedPageMaximum}`);
check('priority A reflects evidence improvements', priorityA >= detailed.length - expectedDetailedPageMaximum, `actual=${priorityA}, minimum=${detailed.length - expectedDetailedPageMaximum}`);
check(
  'production publication date gaps within quality debt budget',
  corePublicationGaps <= expectedPublicationMaximum,
  `actual=${corePublicationGaps}, maximum=${expectedPublicationMaximum}`,
);
check(
  'production primary evidence gaps within quality debt budget',
  corePageGaps <= expectedPageMaximum,
  `actual=${corePageGaps}, maximum=${expectedPageMaximum}`,
);

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
check('dashboard linked from main navigation', index.includes('href="./quality.html"'));
const html = fs.readFileSync(path.join(root, 'quality.html'), 'utf8');
check('dashboard explains no automatic promotion', html.includes('本番昇格を自動決定しません'));
check('dashboard requires human review', html.includes('原文突合') && html.includes('別確認者レビュー'));
const js = fs.readFileSync(path.join(root, 'assets/quality.js'), 'utf8');
check('dashboard verifies bundle SHA-256', js.includes("crypto.subtle.digest('SHA-256'"));
check('dashboard has no recommendation language', !['おすすめ銘柄', '買い推奨', '勝率'].some(term => (html + js).includes(term)));

fs.mkdirSync('artifacts', { recursive: true });
const report = {
  version: 'quality-dashboard-v1',
  checkedAt: new Date().toISOString(),
  reviewQueue: {
    core: core.length,
    detailed: detailed.length,
    structuredReviewableTotal: structuredReviewable.length,
    structuredReviewableMinimum: expectedStructuredReviewableMinimum,
    priorityA,
    priorityB,
    detailedPageEvidenceMaximum: expectedDetailedPageMaximum,
  },
  qualityDebtBudget: {
    publicationDateMaximum: expectedPublicationMaximum,
    pageEvidenceMaximum: expectedPageMaximum,
    publicationDateActual: corePublicationGaps,
    pageEvidenceActual: corePageGaps,
  },
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  checks,
  issues,
};
fs.writeFileSync('artifacts/quality-dashboard-report-v1.json', `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
