import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-priority-queue.json');
const SELECT_COUNT = 25;
const MARKET_QUOTAS = { Prime: 15, Growth: 5, Standard: 5 };
const MAX_PER_INDUSTRY_PER_MARKET = 3;

const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bundle.manifest.json'), 'utf8'));
const compressed = Buffer.concat(manifest.parts.map(part => fs.readFileSync(path.join(DATA_DIR, part.file))));
const data = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));

const marketScores = { Prime: 18, Growth: 14, Standard: 8 };
const industryRules = [
  [/情報・通信/, 18, 'DX・AI・SaaSの比較需要が高い'],
  [/電気機器/, 17, '半導体・電子部品・設備投資の比較需要が高い'],
  [/機械/, 16, '設備投資・海外展開・資本配分の比較需要が高い'],
  [/精密機器/, 16, '高付加価値製品と研究開発の比較需要が高い'],
  [/サービス/, 15, '新規事業・人材投資・M&Aの比較需要が高い'],
  [/医薬品/, 15, '研究開発・パイプライン・資本配分の比較需要が高い'],
  [/化学/, 14, '事業ポートフォリオ・設備投資・ROICの比較需要が高い'],
  [/輸送用機器/, 14, '構造転換・EV・海外展開の比較需要が高い'],
  [/銀行|証券|保険|その他金融/, 14, '資本効率・株主還元の比較需要が高い'],
  [/不動産/, 13, '資産回転・ROE・還元方針の比較需要が高い'],
  [/卸売/, 12, '事業ポートフォリオ・M&Aの比較需要が高い'],
  [/小売/, 11, '店舗投資・DX・地域戦略の比較需要が高い'],
  [/建設/, 11, '受注・人的資本・資本政策の比較需要が高い'],
  [/陸運|海運|空運|倉庫/, 11, '大型投資・インフラ・資本配分の比較需要が高い'],
  [/食料品/, 10, 'ブランド投資・海外展開・価格戦略の比較需要が高い'],
  [/金属製品|鉄鋼|非鉄金属/, 10, '市況対応・設備投資・構造改革の比較需要が高い'],
  [/その他製品/, 9, '事業多角化・新規事業の比較需要がある'],
];

const officialHost = value => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return !/jpx|google|yahoo|nikkei|kabutan|minkabu/.test(host);
  } catch {
    return false;
  }
};

const scoreCompany = company => {
  const reasons = [];
  let score = marketScores[company.market] ?? 4;
  reasons.push(`${company.market || '市場未確認'}市場 ${marketScores[company.market] ?? 4}点`);

  const industry = String(company.industry || '未確認');
  const industryRule = industryRules.find(([pattern]) => pattern.test(industry));
  if (industryRule) {
    score += industryRule[1];
    reasons.push(`${industry} ${industryRule[1]}点: ${industryRule[2]}`);
  } else {
    score += 6;
    reasons.push(`${industry} 6点: 業種分散枠`);
  }

  if (/ホールディングス|ホールディング|ＨＤ|HD|グループ|Group/i.test(company.name || '')) {
    score += 8;
    reasons.push('持株会社・グループ経営 8点: M&A・事業ポートフォリオ探索に適する');
  }
  if (officialHost(company.sourceUrl)) {
    score += 8;
    reasons.push('会社公式URL候補あり 8点: 調査着手しやすい');
  }
  if (company.planPublishedDate) {
    score += 4;
    reasons.push('資料公表日候補あり 4点');
  }
  if (company.flags && Object.values(company.flags).some(Boolean)) {
    score += 4;
    reasons.push('戦略フラグ候補あり 4点');
  }

  return {
    code: String(company.code),
    name: company.name,
    market: company.market,
    industry,
    sourceUrl: company.sourceUrl ?? null,
    lastVerifiedDate: company.lastVerifiedDate ?? null,
    score,
    reasons,
  };
};

const candidates = data.companies
  .filter(company => company.stage === 'jpx_indexed')
  .map(scoreCompany)
  .sort((a, b) => b.score - a.score || String(a.code).localeCompare(String(b.code), 'ja'));

if (candidates.length !== 370) throw new Error(`Expected 370 coverage beta companies, got ${candidates.length}`);

const selected = [];
const selectedCodes = new Set();
for (const [market, quota] of Object.entries(MARKET_QUOTAS)) {
  const industryCounts = new Map();
  for (const candidate of candidates.filter(row => row.market === market)) {
    if (selected.filter(row => row.market === market).length >= quota) break;
    const count = industryCounts.get(candidate.industry) || 0;
    if (count >= MAX_PER_INDUSTRY_PER_MARKET) continue;
    selected.push({ ...candidate, selectionReason: `${market}市場の優先枠` });
    selectedCodes.add(candidate.code);
    industryCounts.set(candidate.industry, count + 1);
  }
}

for (const candidate of candidates) {
  if (selected.length >= SELECT_COUNT) break;
  if (selectedCodes.has(candidate.code)) continue;
  selected.push({ ...candidate, selectionReason: '総合スコア補完枠' });
  selectedCodes.add(candidate.code);
}

if (selected.length !== SELECT_COUNT) throw new Error(`Expected ${SELECT_COUNT} selected companies, got ${selected.length}`);

const report = {
  version: 'coverage-priority-queue-v1',
  generatedAt: new Date().toISOString(),
  sourceBundleSha256: manifest.sha256,
  coverageBetaCount: candidates.length,
  selectionCount: selected.length,
  marketQuotas: MARKET_QUOTAS,
  maxPerIndustryPerMarket: MAX_PER_INDUSTRY_PER_MARKET,
  selected,
  marketDistribution: Object.fromEntries(['Prime', 'Growth', 'Standard'].map(market => [market, selected.filter(row => row.market === market).length])),
  industryDistribution: Object.fromEntries([...new Set(selected.map(row => row.industry))].sort().map(industry => [industry, selected.filter(row => row.industry === industry).length])),
  top100: candidates.slice(0, 100),
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  coverageBetaCount: report.coverageBetaCount,
  selectionCount: report.selectionCount,
  marketDistribution: report.marketDistribution,
  industryDistribution: report.industryDistribution,
  selected: report.selected.map(row => ({ code: row.code, name: row.name, market: row.market, industry: row.industry, score: row.score })),
}, null, 2));
