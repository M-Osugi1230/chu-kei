// Chu-kei Insight: 企業別静的ページ生成 (SEO)
// 検索インデックス (company-index.json.gz) の正本データだけを使い、
// 中計判定済み企業についてインデックス可能な静的HTMLを生成する。
// 生成物は site/company/<code>.html と site/sitemap.xml への企業URL追加。
// データ更新後は `node scripts/build_company_pages_v1.mjs` で再生成すること。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_ORIGIN = 'https://chu-kei-insight-preview.netlify.app';
const RESOLVED = new Set(['current', 'expired', 'no_formal_plan', 'found_unstructured']);
const STATUS_LABEL = {
  current: '現行の中期経営計画を確認済み',
  expired: '期間が終了した中期経営計画を確認済み',
  no_formal_plan: '正式な中期経営計画なしと確認済み',
  found_unstructured: '非構造化の中期経営計画を確認済み',
};
const MARKET_LABEL = { Prime: '東証プライム', Standard: '東証スタンダード', Growth: '東証グロース' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const indexGz = readFileSync(join(root, 'site/data/frontend/company-index.json.gz'));
const index = JSON.parse(gunzipSync(indexGz).toString('utf8'));
const companies = (index.companies || []).filter((c) => RESOLVED.has(c.planStatus));
companies.sort((a, b) => String(a.code).localeCompare(String(b.code)));

mkdirSync(join(root, 'site/company'), { recursive: true });

function page(c) {
  const market = MARKET_LABEL[c.market] || c.market || '';
  const status = STATUS_LABEL[c.planStatus] || c.planStatus;
  const title = `${c.name}（${c.code}）の中期経営計画 | Chu-kei Insight`;
  const desc = `${c.name}（証券コード${c.code}、${market}、${c.industry || ''}）の中期経営計画の確認状況と概要。${status}。一次情報に基づく確認日と品質レベルを掲載。`;
  const url = `${SITE_ORIGIN}/company/${c.code}.html`;
  const rows = [
    ['証券コード', c.code],
    ['市場', market],
    ['業種', c.industry],
    ['中期経営計画の状態', status],
    ['計画公表日', c.planPublishedDate],
    ['状態確認日', c.planStatusCheckedAt],
    ['最終確認日', c.lastVerifiedDate],
    ['テーマ', Array.isArray(c.themes) && c.themes.length ? c.themes.join('、') : null],
    ['品質レベル', c.quality?.label],
  ].filter(([, v]) => v != null && v !== '');
  const table = rows.map(([k, v]) => `        <tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url,
    description: desc,
    about: { '@type': 'Organization', name: c.name, tickerSymbol: c.code },
  };
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<header>
  <p><a href="/">Chu-kei Insight</a> — 上場企業の中期経営計画データベース</p>
</header>
<main>
  <h1>${esc(c.name)}（${esc(c.code)}）の中期経営計画</h1>
  <p>${esc(c.summary || '')}</p>
  <table>
    <tbody>
${table}
    </tbody>
  </table>
  <p><a href="/?company=${encodeURIComponent(c.code)}">この企業の詳細・数値目標・比較をワークスペースで見る</a></p>
  <p>本ページは企業の公式開示に基づく確認状況の要約です。未確認の項目は未確認と表示し、推測で補完することはありません。投資助言・銘柄推奨を目的としたものではありません。</p>
</main>
<footer>
  <p><a href="/">Chu-kei Insight トップ</a> / <a href="/pricing.html">料金</a> / <a href="/contact.html">問い合わせ</a> / <a href="/privacy.html">プライバシー</a></p>
</footer>
</body>
</html>
`;
}

for (const c of companies) {
  writeFileSync(join(root, 'site/company', `${c.code}.html`), page(c));
}

// sitemap: 既存の基幹URLを保持し、企業URLを差し替える
const sitemapPath = join(root, 'site/sitemap.xml');
let core = [];
if (existsSync(sitemapPath)) {
  const xml = readFileSync(sitemapPath, 'utf8');
  core = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => !u.includes('/company/'));
}
const urls = [...core, ...companies.map((c) => `${SITE_ORIGIN}/company/${c.code}.html`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
writeFileSync(sitemapPath, sitemap);

console.log(`company pages: ${companies.length}, sitemap urls: ${urls.length}`);
