// Chu-kei Insight: 企業別静的ページ生成 (SEO)
// 検索インデックス (company-index.json.gz) の正本データだけを使い、
// 中計判定済み企業についてインデックス可能な静的HTMLを生成する。
// 各社の詳細レコード (site/data/frontend/details-NNN.json.gz) があれば、
// 計画名・計画期間、数値目標、資本政策、株主還元、ハイライト、出典を追加する。
// 生成物は site/company/<code>.html と site/sitemap.xml への企業URL追加。
// データ更新後は `node scripts/build_company_pages_v1.mjs` で再生成すること。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_ORIGIN = 'https://chu-kei.com';
const RESOLVED = new Set(['current', 'expired', 'no_formal_plan', 'found_unstructured']);
const STATUS_LABEL = {
  current: '現行の中期経営計画を確認済み',
  expired: '期間が終了した中期経営計画を確認済み',
  no_formal_plan: '正式な中期経営計画なしと確認済み',
  found_unstructured: '非構造化の中期経営計画を確認済み',
};
const MARKET_LABEL = { Prime: '東証プライム', Standard: '東証スタンダード', Growth: '東証グロース' };

// テーマページの固定URL。存在する生成ページに限ってリンク化する。
const THEME_SLUGS = new Map([
  ['人的資本', 'human-capital'], ['サステナビリティ', 'sustainability'],
  ['株主還元', 'shareholder-return'], ['資本効率', 'capital-efficiency'],
  ['海外', 'overseas'], ['DX', 'dx'], ['AI', 'ai'],
  ['事業成長', 'business-growth'], ['生産性', 'productivity'],
  ['M&A', 'ma'], ['商品・サービス', 'products-services'],
  ['設備投資', 'capex'], ['事業再編', 'restructuring'],
  ['事業ポートフォリオ', 'business-portfolio'], ['研究開発', 'rd'],
]);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hasText = (v) => typeof v === 'string' && v.trim() !== '';

const indexGz = readFileSync(join(root, 'site/data/frontend/company-index.json.gz'));
const index = JSON.parse(gunzipSync(indexGz).toString('utf8'));
const companies = (index.companies || []).filter((c) => RESOLVED.has(c.planStatus));
companies.sort((a, b) => String(a.code).localeCompare(String(b.code)));

// 詳細シャードの読み込み（同一シャードは1回だけ読む）
const detailCache = new Map();
function loadDetailShard(detailFile) {
  if (detailCache.has(detailFile)) return detailCache.get(detailFile);
  const byCode = new Map();
  try {
    const gz = readFileSync(join(root, 'site/data/frontend', detailFile));
    const parsed = JSON.parse(gunzipSync(gz).toString('utf8'));
    const records = Array.isArray(parsed) ? parsed : (parsed.companies || []);
    for (const r of records) {
      if (r && r.code != null) byCode.set(String(r.code), r);
    }
  } catch (e) {
    console.warn(`詳細シャードの読み込みに失敗しました: ${detailFile}: ${e.message}`);
  }
  detailCache.set(detailFile, byCode);
  return byCode;
}
function getDetail(c) {
  if (!c || !c.detailFile) return null;
  return loadDetailShard(c.detailFile).get(String(c.code)) || null;
}

mkdirSync(join(root, 'site/company'), { recursive: true });

function page(c, d = null) {
  const market = MARKET_LABEL[c.market] || c.market || '';
  const status = STATUS_LABEL[c.planStatus] || c.planStatus;
  const title = `${c.name}（${c.code}）の中期経営計画 | Chu-kei Insight`;
  const desc = `${c.name}（証券コード${c.code}、${market}、${c.industry || ''}）の中期経営計画の確認状況と概要。${status}。一次情報に基づく確認日と品質レベルを掲載。`;
  const url = `${SITE_ORIGIN}/company/${c.code}.html`;
  const summary = hasText(d?.summary) ? d.summary : c.summary;
  const themeLinks = Array.isArray(c.themes) ? [...new Set(c.themes)].map((name) => {
    const slug = THEME_SLUGS.get(name);
    if (slug && ['current', 'expired'].includes(c.planStatus)
        && existsSync(join(root, 'site/themes', `${slug}.html`))) {
      return `<a href="/themes/${slug}.html">${esc(name)}</a>`;
    }
    return esc(name);
  }).join('、') : '';
  const rows = [
    ['証券コード', c.code],
    ['市場', market],
    ['業種', c.industry],
    ['中期経営計画の状態', status],
    ['計画名', d?.document],
    ['計画期間', d?.period],
    ['計画公表日', c.planPublishedDate],
    ['状態確認日', c.planStatusCheckedAt],
    ['最終確認日', c.lastVerifiedDate],
    ['テーマ', Array.isArray(c.themes) && c.themes.length ? c.themes.join('、') : null],
    ['品質レベル', c.quality?.label],
  ].filter(([, v]) => v != null && v !== '');
  const table = rows.map(([k, v]) => `        <tr><th scope="row">${esc(k)}</th><td>${k === 'テーマ' ? themeLinks : esc(v)}</td></tr>`).join('\n');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url,
    description: desc,
    ...(c.lastVerifiedDate ? { dateModified: c.lastVerifiedDate } : {}),
    inLanguage: 'ja',
    about: { '@type': 'Organization', name: c.name, tickerSymbol: c.code },
  };
  const overviewHeading = hasText(d?.document) || hasText(d?.period)
    ? '  <h2>中期経営計画の概要</h2>\n'
    : '';

  const sections = [];
  const targets = [
    ['売上高・収益', d?.revenue],
    ['利益', d?.profit],
    ['収益性・資本効率', d?.margin],
  ].filter(([, v]) => hasText(v));
  if (targets.length) {
    sections.push(`  <section>\n    <h2>数値目標</h2>\n${targets.map(([label, v]) => `    <h3>${esc(label)}</h3>\n    <p>${esc(v)}</p>`).join('\n')}\n  </section>`);
  }
  if (hasText(d?.capital)) {
    sections.push(`  <section>\n    <h2>資本政策</h2>\n    <p>${esc(d.capital)}</p>\n  </section>`);
  }
  if (hasText(d?.returnPolicy)) {
    sections.push(`  <section>\n    <h2>株主還元</h2>\n    <p>${esc(d.returnPolicy)}</p>\n  </section>`);
  }
  const highlights = Array.isArray(d?.highlights) ? d.highlights.filter((v) => hasText(v)) : [];
  if (highlights.length) {
    sections.push(`  <section>\n    <h2>ハイライト</h2>\n    <ul>\n${highlights.map((v) => `      <li>${esc(v)}</li>`).join('\n')}\n    </ul>\n  </section>`);
  }
  if (hasText(d?.sourceUrl) || hasText(d?.document)) {
    const linkText = hasText(d?.document) ? `公式資料（${d.document}）` : '公式資料';
    const sourceBody = hasText(d?.sourceUrl)
      ? `<a href="${esc(d.sourceUrl)}">${esc(linkText)}</a>`
      : esc(d.document);
    sections.push(`  <section>\n    <h2>出典</h2>\n    <p>${sourceBody}</p>\n  </section>`);
  }
  const extraSections = sections.length ? `\n${sections.join('\n')}` : '';

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
  <p>${esc(summary || '')}</p>
${overviewHeading}  <table>
    <tbody>
${table}
    </tbody>
  </table>${extraSections}
  <p><a href="/?company=${encodeURIComponent(c.code)}">この企業の詳細・数値目標・比較をワークスペースで見る</a></p>
  <p>本ページは企業の公式開示に基づく確認状況の要約です。未確認の項目は未確認と表示し、推測で補完することはありません。投資助言・銘柄推奨を目的としたものではありません。</p>
</main>
<footer>
  <p><a href="/">Chu-kei Insight トップ</a> / <a href="/pricing.html">料金</a> / <a href="/contact.html">問い合わせ</a> / <a href="/privacy.html">プライバシー</a></p>
</footer>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "a43b478d115f4ce1af2a08b6335eea73"}'></script><!-- End Cloudflare Web Analytics -->
<!-- Microsoft Clarity --><script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","zfzkqa54zj");</script><!-- End Microsoft Clarity -->
</body>
</html>
`;
}

for (const c of companies) {
  writeFileSync(join(root, 'site/company', `${c.code}.html`), page(c, getDetail(c)));
}

// sitemap: 基幹URL（テーマページを含む）を保持し、企業URLだけを再生成する。
const sitemapPath = join(root, 'site/sitemap.xml');
let core = [];
if (existsSync(sitemapPath)) {
  const xml = readFileSync(sitemapPath, 'utf8');
  core = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    .filter((u) => !u.startsWith(`${SITE_ORIGIN}/company/`)
      && u !== `${SITE_ORIGIN}/themes.html`
      && !u.startsWith(`${SITE_ORIGIN}/themes/`));
}
const themesIndex = existsSync(join(root, 'site/themes.html')) ? [`${SITE_ORIGIN}/themes.html`] : [];
const themeUrls = [...THEME_SLUGS.values()]
  .filter((slug) => existsSync(join(root, 'site/themes', `${slug}.html`)))
  .map((slug) => `${SITE_ORIGIN}/themes/${slug}.html`);
const urls = [...new Set([...core, ...themesIndex, ...themeUrls,
  ...companies.map((c) => `${SITE_ORIGIN}/company/${c.code}.html`)])];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
writeFileSync(sitemapPath, sitemap);

console.log(`company pages: ${companies.length}, sitemap urls: ${urls.length}`);
