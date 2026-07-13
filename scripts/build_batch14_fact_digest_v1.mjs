import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const INPUT_DIR = path.join(ROOT, 'operations', 'research', 'batch14-researched');
const OUTPUT_PATH = path.join(ROOT, 'operations', 'research', 'structured-expansion-batch-14-fact-digest.json');
const CODES = ['1721','2127','3288','3635','2153','4004','3107','3070','3289'];

const patterns = {
  current: /2026|2027|2028|令和8|令和9|通期|業績予想|計画/i,
  sales: /売上高|売上収益|営業収益|受注高|成約数|GMV|ARR/i,
  profit: /営業利益|事業利益|経常利益|純利益|EBITDA|利益率/i,
  efficiency: /ROE|ROIC|ROA|自己資本比率|PBR|資本コスト/i,
  capital: /設備投資|成長投資|投資計画|キャピタルアロケーション|M&A|買収|事業ポートフォリオ/i,
  return: /配当|総還元性向|配当性向|DOE|自己株/i,
  strategy: /中期|長期|経営計画|ビジョン|成長戦略|DX|AI|海外|人材|人的資本/i,
};

const scorePage = text => {
  let score = 0;
  for (const [key, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) score += key === 'current' ? 18 : key === 'strategy' ? 12 : 15;
  }
  const numbers = text.match(/\d[\d,.]*\s*(?:億円|百万円|%|円|件|社|人)/g)?.length || 0;
  return score + Math.min(numbers, 25);
};

const extractMatches = text => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chunks = normalized.split(/(?<=[。！？])\s*/).filter(Boolean);
  const selected = [];
  for (const chunk of chunks) {
    const matched = Object.values(patterns).some(pattern => pattern.test(chunk));
    const hasNumber = /\d[\d,.]*\s*(?:億円|百万円|%|円|件|社|人)/.test(chunk);
    if (matched && hasNumber) selected.push(chunk.slice(0, 500));
    if (selected.length >= 10) break;
  }
  if (selected.length < 3) return normalized.slice(0, 1800);
  return selected.join(' ').slice(0, 2200);
};

const companies = [];
for (const code of CODES) {
  const file = path.join(INPUT_DIR, `${code}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing evidence file: ${code}`);
  const company = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pages = [];
  for (const [documentIndex, document] of (company.documents || []).entries()) {
    for (const page of document.evidencePages || []) {
      const text = page.snippet || '';
      pages.push({
        documentIndex,
        documentUrl: document.url,
        documentTitle: document.anchorText,
        page: page.page,
        score: scorePage(text),
        digest: extractMatches(text),
      });
    }
  }
  const selectedPages = pages
    .sort((a, b) => b.score - a.score || a.documentIndex - b.documentIndex || a.page - b.page)
    .filter((row, index, rows) => rows.findIndex(other => other.documentUrl === row.documentUrl && other.page === row.page) === index)
    .slice(0, 12);
  const categoryCoverage = Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [key, selectedPages.filter(row => pattern.test(row.digest)).map(row => ({ documentTitle: row.documentTitle, documentUrl: row.documentUrl, page: row.page, digest: row.digest })).slice(0, 4)]));
  companies.push({
    code,
    name: company.name,
    market: company.market,
    industry: company.industry,
    readinessScore: company.readinessScore,
    officialIrUrl: company.officialIrUrl,
    documents: (company.documents || []).map(document => ({ url: document.url, title: document.anchorText, pageCount: document.pageCount, evidenceScore: document.evidenceScore })),
    selectedPages,
    categoryCoverage,
  });
}

const report = {
  version: 'batch14-fact-digest-v1',
  generatedAt: new Date().toISOString(),
  companyCount: companies.length,
  companies,
};
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ companyCount: report.companyCount, companies: companies.map(company => ({ code: company.code, name: company.name, selectedPages: company.selectedPages.length })) }, null, 2));
