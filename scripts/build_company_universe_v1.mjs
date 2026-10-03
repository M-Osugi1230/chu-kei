import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const INPUT_PATH = process.env.JPX_LISTED_COMPANIES_PATH
  ? path.resolve(process.env.JPX_LISTED_COMPANIES_PATH)
  : path.join(ROOT, 'operations', 'research', 'jpx-listed-companies-latest.json');
const OUTPUT_PATH = process.env.COMPANY_UNIVERSE_OUTPUT
  ? path.resolve(process.env.COMPANY_UNIVERSE_OUTPUT)
  : path.join(ROOT, 'operations', 'universe', 'current-universe-v1.json');
const PUBLIC_OUTPUT_PATH = process.env.COMPANY_UNIVERSE_PUBLIC_OUTPUT
  ? path.resolve(process.env.COMPANY_UNIVERSE_PUBLIC_OUTPUT)
  : path.join(ROOT, 'site', 'data', 'company-universe-v1.json');

const TARGET_MARKETS = new Set(['Prime', 'Standard', 'Growth']);

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

function normalizeMarket(value) {
  const text = String(value || '');
  if (!text.includes('内国株式')) return null;
  if (text.includes('プライム')) return 'Prime';
  if (text.includes('スタンダード')) return 'Standard';
  if (text.includes('グロース')) return 'Growth';
  return null;
}

function normalizeIndustry(value) {
  const text = String(value || '').trim();
  return text && !['-', '－', '—'].includes(text) ? text : '未分類';
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

const jpx = readJson(INPUT_PATH);
if (jpx.version !== 'jpx-listed-companies-v1') {
  throw new Error(`Unsupported JPX list version: ${jpx.version}`);
}
if (!Array.isArray(jpx.records)) throw new Error('JPX records must be an array');

const byCode = new Map();
for (const row of jpx.records) {
  const market = normalizeMarket(row.marketProduct);
  if (!market || !TARGET_MARKETS.has(market)) continue;

  const code = normalizeCode(row.code);
  const name = String(row.name || '').trim();
  if (!/^[0-9A-Z]{4}$/.test(code) || !name) continue;

  const normalized = {
    code,
    name,
    market,
    industry: normalizeIndustry(row.industry33),
    marketProduct: String(row.marketProduct || '').trim(),
    listingStatus: 'active',
  };

  const previous = byCode.get(code);
  if (previous && (previous.name !== normalized.name || previous.market !== normalized.market)) {
    throw new Error(`Conflicting JPX rows for ${code}`);
  }
  byCode.set(code, normalized);
}

const companies = [...byCode.values()]
  .sort((left, right) => left.code.localeCompare(right.code, 'ja'));

if (!companies.length) throw new Error('No Prime/Standard/Growth domestic companies found');

const marketCounts = Object.fromEntries(
  ['Prime', 'Standard', 'Growth'].map(market => [
    market,
    companies.filter(company => company.market === market).length,
  ]),
);

const fetchedAt = jpx.fetchedAt || null;
const snapshot = {
  version: 'company-universe-v1',
  generatedAt: new Date().toISOString(),
  sourceFetchedAt: fetchedAt,
  sourcePage: jpx.sourcePage || null,
  sourceWorkbook: jpx.sourceWorkbook || null,
  scope: {
    markets: ['Prime', 'Standard', 'Growth'],
    securityType: 'domestic_common_listed_company',
    includesProMarket: false,
    includesEtfEtn: false,
    includesReit: false,
  },
  companyCount: companies.length,
  marketCounts,
  companies,
};

writeJson(OUTPUT_PATH, snapshot);
writeJson(PUBLIC_OUTPUT_PATH, snapshot);

console.log(JSON.stringify({
  companyCount: snapshot.companyCount,
  marketCounts: snapshot.marketCounts,
  sourceFetchedAt: snapshot.sourceFetchedAt,
  output: path.relative(ROOT, OUTPUT_PATH),
  publicOutput: path.relative(ROOT, PUBLIC_OUTPUT_PATH),
}, null, 2));
