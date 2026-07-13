import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research', 'source-coverage-50-queue.json');
const TARGET_SOURCE_CONFIRMED = Number(process.env.TARGET_SOURCE_CONFIRMED || 285);
const POOL_MULTIPLIER = Number(process.env.SOURCE_DISCOVERY_POOL_MULTIPLIER || 2);
const MIN_EXTRA_POOL = 40;
const MAX_PER_MARKET_INDUSTRY = 18;

const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const digest = crypto.createHash('sha256').update(compressed).digest('hex');
if (digest !== manifest.sha256) throw new Error(`Bundle SHA-256 mismatch: ${digest}`);
const data = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const marketScores = { Prime: 18, Growth: 14, Standard: 10 };
const industryRules = [
  [/情報・通信/, 18, 'DX・AI・SaaS'],
  [/電気機器/, 17, '半導体・電子部品・設備投資'],
  [/機械/, 16, '設備投資・海外展開・資本配分'],
  [/精密機器/, 16, '高付加価値製品・研究開発'],
  [/サービス/, 15, '新規事業・人材投資・M&A'],
  [/医薬品/, 15, '研究開発・パイプライン・資本配分'],
  [/化学/, 14, '事業ポートフォリオ・設備投資・ROIC'],
  [/輸送用機器/, 14, '構造転換・EV・海外展開'],
  [/銀行|証券|保険|その他金融/, 14, '資本効率・株主還元'],
  [/不動産/, 13, '資産回転・ROE・還元方針'],
  [/卸売/, 12, '事業ポートフォリオ・M&A'],
  [/小売/, 11, '店舗投資・DX・地域戦略'],
  [/建設/, 11, '受注・人的資本・資本政策'],
  [/陸運|海運|空運|倉庫/, 11, '大型投資・インフラ・資本配分'],
  [/食料品/, 10, 'ブランド投資・海外展開・価格戦略'],
  [/金属製品|鉄鋼|非鉄金属/, 10, '市況対応・設備投資・構造改革'],
  [/その他製品/, 9, '事業多角化・新規事業'],
];

const normalizeName = value => String(value || '')
  .replace(/[\s　]+/g, '')
  .replace(/株式会社|（株）|㈱/g, '')
  .replace(/ホールディングス|ホールディング|ＨＤ|HD|グループ|Group/gi, '')
  .toLowerCase();

const sourceConfirmed = data.companies.filter(company => company.stage !== 'jpx_indexed').length;
const needed = Math.max(0, TARGET_SOURCE_CONFIRMED - sourceConfirmed);
const coverageCompanies = data.companies.filter(company => company.stage === 'jpx_indexed');
const poolSize = Math.min(
  coverageCompanies.length,
  Math.max(needed * POOL_MULTIPLIER, needed + MIN_EXTRA_POOL),
);

const scoreCompany = company => {
  const industry = String(company.industry || '未確認');
  const industryRule = industryRules.find(([pattern]) => pattern.test(industry));
  let score = marketScores[company.market] ?? 6;
  const reasons = [`${company.market || '市場未確認'}市場`];
  if (industryRule) {
    score += industryRule[1];
    reasons.push(industryRule[2]);
  } else {
    score += 6;
    reasons.push('業種分散');
  }
  if (/ホールディングス|ホールディング|ＨＤ|HD|グループ|Group/i.test(company.name || '')) {
    score += 8;
    reasons.push('グループ経営');
  }
  if (company.flags && Object.values(company.flags).some(Boolean)) {
    score += 3;
    reasons.push('既存戦略フラグ候補');
  }
  return {
    code: String(company.code),
    name: company.name,
    normalizedName: normalizeName(company.name),
    market: company.market,
    industry,
    jpxUrl: company.sourceUrl ?? null,
    lastVerifiedDate: company.lastVerifiedDate ?? null,
    score,
    reasons,
  };
};

const ranked = coverageCompanies
  .map(scoreCompany)
  .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code, 'ja'));

const selected = [];
const groupCounts = new Map();
for (const candidate of ranked) {
  if (selected.length >= poolSize) break;
  const key = `${candidate.market}|${candidate.industry}`;
  const count = groupCounts.get(key) || 0;
  if (count >= MAX_PER_MARKET_INDUSTRY) continue;
  selected.push(candidate);
  groupCounts.set(key, count + 1);
}
for (const candidate of ranked) {
  if (selected.length >= poolSize) break;
  if (selected.some(row => row.code === candidate.code)) continue;
  selected.push(candidate);
}

const report = {
  version: 'source-coverage-50-queue-v1',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: manifest.sha256,
  companyTotal: data.companies.length,
  sourceConfirmedBefore: sourceConfirmed,
  targetSourceConfirmed: TARGET_SOURCE_CONFIRMED,
  needed,
  coverageBetaBefore: coverageCompanies.length,
  candidatePoolSize: selected.length,
  maxPerMarketIndustry: MAX_PER_MARKET_INDUSTRY,
  selected,
  marketDistribution: Object.fromEntries(['Prime', 'Growth', 'Standard'].map(market => [
    market,
    selected.filter(row => row.market === market).length,
  ])),
  industryDistribution: Object.fromEntries(
    [...new Set(selected.map(row => row.industry))]
      .sort((a, b) => a.localeCompare(b, 'ja'))
      .map(industry => [industry, selected.filter(row => row.industry === industry).length]),
  ),
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  sourceConfirmedBefore: report.sourceConfirmedBefore,
  targetSourceConfirmed: report.targetSourceConfirmed,
  needed: report.needed,
  candidatePoolSize: report.candidatePoolSize,
  marketDistribution: report.marketDistribution,
}, null, 2));
