import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(ROOT, file), content);
const readJson = file => JSON.parse(read(file));
const writeJson = (file, value) => write(file, `${JSON.stringify(value, null, 2)}\n`);

function replaceRequired(file, before, after) {
  const source = read(file);
  if (source.includes(after)) return false;
  if (!source.includes(before)) {
    throw new Error(`Expected source not found in ${file}: ${before.slice(0, 100)}`);
  }
  write(file, source.replace(before, after));
  return true;
}

const changes = [];

if (replaceRequired(
  'scripts/validate_quality_debt_budget_v1.mjs',
  "  asOfDate: '2026-07-11',",
  "  asOfDate: '2026-08-01',",
)) changes.push('quality debt default date');

if (replaceRequired(
  'scripts/validate_quality_debt_budget_v1.mjs',
  "    if ((company.quality?.stars ?? 0) < 5) addDebt(company, 'core.notFiveStar', `stars=${company.quality?.stars ?? null}`);",
  "    if (company.quality?.deepVerified !== true) addDebt(company, 'deepVerification.notApproved', `status=${company.quality?.deepVerificationStatus ?? 'not_started'}, stars=${company.quality?.stars ?? null}`);",
)) changes.push('deep verification debt dimension');

const budgetPath = 'operations/quality-debt-budget-v1.json';
const budget = readJson(budgetPath);
let budgetChanged = false;
if (budget.recordedAt !== '2026-08-01') {
  budget.recordedAt = '2026-08-01';
  budgetChanged = true;
}
if (budget.policy?.asOfDate !== '2026-08-01') {
  budget.policy.asOfDate = '2026-08-01';
  budgetChanged = true;
}
if (Object.hasOwn(budget.maximumCounts ?? {}, 'core.notFiveStar')) {
  delete budget.maximumCounts['core.notFiveStar'];
  budgetChanged = true;
}
if (budget.maximumCounts?.['deepVerification.notApproved'] !== 3000) {
  budget.maximumCounts['deepVerification.notApproved'] = 3000;
  budgetChanged = true;
}
if (budget.rules?.deepVerificationPolicy !== '未承認件数はPhase 0基準値3,000社から単調減少させ、承認済み企業を自動で増やさない') {
  budget.rules.deepVerificationPolicy = '未承認件数はPhase 0基準値3,000社から単調減少させ、承認済み企業を自動で増やさない';
  budgetChanged = true;
}
if (budgetChanged) {
  writeJson(budgetPath, budget);
  changes.push('quality debt budget baseline');
}

if (replaceRequired(
  'scripts/validate_quality_dashboard_v1.mjs',
  "check('dashboard requires human review', html.includes('原文突合') && html.includes('別確認者レビュー'));",
  "check('dashboard requires human review', (html.includes('全文精読') || html.includes('原文突合')) && (html.includes('別確認者レビュー') || html.includes('独立した人手レビュー')));",
)) changes.push('quality dashboard human review wording');

if (replaceRequired(
  'scripts/run_local_quality_gate.mjs',
  "    env: process.env,",
  "    env: {\n      ...process.env,\n      QUALITY_AS_OF_DATE: process.env.QUALITY_AS_OF_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),\n    },",
)) changes.push('local quality JST date');

console.log(JSON.stringify({
  schemaVersion: 'phase0-validator-alignment-v1',
  changed: changes.length,
  changes,
}, null, 2));
