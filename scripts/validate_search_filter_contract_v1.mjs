import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  normalizeSearchText,
  tokenizeSearchQuery,
  prepareCompaniesForSearch,
  filterAndRankCompanies,
  matchesCompanyFilters,
} from '../site/assets/search-core.js';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'search-filter-contract-report-v1.json');
const checks = [];
const issues = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); if (!ok) issues.push({ name, detail }); };

function readBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
  const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
  const digest = crypto.createHash('sha256').update(compressed).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
  return JSON.parse(zlib.gunzipSync(compressed));
}
function toFullWidth(value) {
  return String(value).replace(/[!-~]/g, character => String.fromCharCode(character.charCodeAt(0) + 0xfee0));
}

let data = { companies: [] };
try {
  data = readBundle();
  check('search source bundle readable', true);
} catch (error) {
  check('search source bundle readable', false, error.message);
}
const companies = prepareCompaniesForSearch(data.companies || []);
const first = companies[0];
const themed = companies.find(company => (company.themes || []).length > 0) || first;

check('prepared company count 570', companies.length === 570, `actual=${companies.length}`);
check('NFKC normalizes full-width code', normalizeSearchText(toFullWidth(first.code)) === normalizeSearchText(first.code));
check('ideographic spaces normalize', normalizeSearchText('  海外　展開  ') === '海外 展開');
check('query tokenization uses AND tokens', JSON.stringify(tokenizeSearchQuery('海外　ROIC')) === JSON.stringify(['海外', 'roic']));

const exactCode = filterAndRankCompanies(companies, { query: first.code });
check('exact code returns one company', exactCode.length === 1 && exactCode[0].code === first.code, `actual=${exactCode.map(company => company.code).join(',')}`);
const fullWidthCode = filterAndRankCompanies(companies, { query: toFullWidth(first.code) });
check('full-width code returns same company', fullWidthCode.length === 1 && fullWidthCode[0].code === first.code);
const exactName = filterAndRankCompanies(companies, { query: first.name });
check('exact company name ranks first', exactName.length >= 1 && exactName[0].code === first.code, `first=${exactName[0]?.code}`);
const multiToken = filterAndRankCompanies(companies, { query: `${first.code} ${first.market}` });
check('multi-token AND search', multiToken.length === 1 && multiToken[0].code === first.code, `actual=${multiToken.length}`);
check('missing token produces zero results', filterAndRankCompanies(companies, { query: `${first.code} __no_such_token__` }).length === 0);
check('empty search returns all companies', filterAndRankCompanies(companies, {}).length === 570);

for (const market of ['Prime', 'Standard', 'Growth']) {
  const expected = companies.filter(company => company.market === market).length;
  const actual = filterAndRankCompanies(companies, { market }).length;
  check(`market filter ${market}`, actual === expected, `actual=${actual}, expected=${expected}`);
}
for (const stage of ['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed']) {
  const expected = companies.filter(company => company.stage === stage).length;
  const actual = filterAndRankCompanies(companies, { stage }).length;
  check(`stage filter ${stage}`, actual === expected, `actual=${actual}, expected=${expected}`);
}
for (const strategy of ['ma', 'capitalEfficiency', 'shareholderReturn', 'overseas', 'dx', 'humanCapital', 'newBusiness', 'restructuring', 'progress']) {
  const expected = companies.filter(company => company.flags?.[strategy]).length;
  const actual = filterAndRankCompanies(companies, { strategy }).length;
  check(`strategy filter ${strategy}`, actual === expected, `actual=${actual}, expected=${expected}`);
}
const combined = filterAndRankCompanies(companies, { query: first.code, market: first.market, stage: first.stage });
check('query market stage intersection', combined.length === 1 && combined[0].code === first.code);
check('mismatched intersection is empty', filterAndRankCompanies(companies, { query: first.code, market: first.market === 'Prime' ? 'Growth' : 'Prime' }).length === 0);
check('theme keyword is searchable', filterAndRankCompanies(companies, { query: themed.themes[0] }).some(company => company.code === themed.code));
check('filter predicate agrees with result', filterAndRankCompanies(companies, { market: first.market, stage: first.stage }).every(company => matchesCompanyFilters(company, { market: first.market, stage: first.stage })));
check('search document is internal only', companies.every(company => typeof company.__searchDocument === 'string' && company.__searchDocument.length > 0));

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
const report = {
  version: 'search-filter-contract-v1',
  checkedAt: new Date().toISOString(),
  companyCount: companies.length,
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  allPassed: issues.length === 0,
  checks,
  issues,
};
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`);
console.log(`\n${report.passed}/${report.total} checks passed`);
process.exit(report.allPassed ? 0 : 1);
