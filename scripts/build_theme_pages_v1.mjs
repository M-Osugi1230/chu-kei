// Chu-kei Insight: テーマ別静的ページ生成（既存の公開インデックスのみ使用）
// node scripts/build_theme_pages_v1.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://chu-kei.com';
const minimum = 15;
const themes = [
  ['人的資本', 'human-capital'],
  ['サステナビリティ', 'sustainability'],
  ['株主還元', 'shareholder-return'],
  ['資本効率', 'capital-efficiency'],
  ['海外', 'overseas'],
  ['DX', 'dx'],
  ['AI', 'ai'],
  ['事業成長', 'business-growth'],
  ['生産性', 'productivity'],
  ['M&A', 'ma'],
  ['商品・サービス', 'products-services'],
  ['設備投資', 'capex'],
  ['事業再編', 'restructuring'],
  ['事業ポートフォリオ', 'business-portfolio'],
  ['研究開発', 'rd'],
];
const marketLabels = { Prime: '東証プライム', Standard: '東証スタンダード', Growth: '東証グロース' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = (v) => typeof v === 'string' && v.trim() ? v.trim() : null;
const compareCode = (a, b) => String(a.code).localeCompare(String(b.code), 'en');
const site = join(root, 'site');
const index = JSON.parse(gunzipSync(readFileSync(join(site, 'data/frontend/company-index.json.gz'))).toString('utf8'));
if (!Array.isArray(index.companies)) throw new Error('company-index.companies が配列ではありません');
const companies = index.companies.filter((c) => ['current', 'expired'].includes(c.planStatus));
const byTheme = new Map(themes.map(([name]) => [name, []]));
const seenCodes = new Set();
for (const c of companies) {
  const code = String(c.code ?? '');
  if (!/^[0-9A-Za-z]+$/.test(code) || !code) throw new Error(`不正な証券コード: ${code}`);
  if (seenCodes.has(code)) throw new Error(`重複した証券コード: ${code}`);
  seenCodes.add(code);
  if (!Number.isInteger(c.metricCount) || c.metricCount < 0) throw new Error(`${code}: metricCount は非負整数が必要です`);
  for (const name of new Set(Array.isArray(c.themes) ? c.themes : [])) {
    if (byTheme.has(name)) byTheme.get(name).push(c);
  }
}
for (const group of byTheme.values()) group.sort(compareCode);

// 企業ページと同じ詳細シャードを参照する。ただし利用するのは概要のみ。
const shardCache = new Map();
function detail(c) {
  if (!text(c.detailFile)) return null;
  if (!shardCache.has(c.detailFile)) {
    const path = join(site, 'data/frontend', c.detailFile);
    const records = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
    const list = Array.isArray(records) ? records : (records.companies || []);
    shardCache.set(c.detailFile, new Map(list.filter((r) => r && r.code != null).map((r) => [String(r.code), r])));
  }
  return shardCache.get(c.detailFile).get(String(c.code)) || null;
}
function excerpt(value, limit = 180) {
  const s = text(value)?.replace(/\s+/g, ' ');
  if (!s) return '未確認';
  const chars = Array.from(s);
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : s;
}
function shell(title, description, url, main, breadcrumb) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url,
    inLanguage: 'ja',
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumb.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
    },
  };
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="stylesheet" href="${url === `${origin}/themes.html` ? './assets/styles.css' : '../assets/styles.css'}">
<link rel="stylesheet" href="${url === `${origin}/themes.html` ? './assets/motion.css' : '../assets/motion.css'}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
<a class="skip-link" href="#main">本文へ移動</a>
<header class="site-header"><div class="header-inner"><a class="brand" href="/">Chu-kei</a><span class="subtitle">日本上場企業 中期経営計画ポータル</span></div></header>
<main id="main" class="section">
<nav aria-label="パンくず"><a href="/">トップ</a> / <a href="/themes.html">テーマ一覧</a>${breadcrumb.length === 3 ? ` / ${esc(breadcrumb[2][0])}` : ''}</nav>
${main}
<section>
  <h2>更新アラート（準備中）</h2>
  <p>中期経営計画の新規公表・改定をお知らせする「進捗・更新アラート」を、Pro の Early access として準備しています。関心のある方は<a href="/pricing.html#waitlist">先行利用の登録</a>からお知らせください。登録は需要の把握が目的で、契約・課金は発生しません。</p>
</section>
</main>
<footer><p><a href="/">Chu-kei Insight トップ</a> / <a href="/quality.html">品質</a> / <a href="/contact.html">問い合わせ</a></p></footer>
<script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "a43b478d115f4ce1af2a08b6335eea73"}'></script>
<!-- Microsoft Clarity --><script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","zfzkqa54zj");</script><!-- End Microsoft Clarity -->
<script src="${url === `${origin}/themes.html` ? './assets/motion.js' : '../assets/motion.js'}" defer></script>
</body>
</html>
`;
}

const active = themes.map(([name, slug]) => ({ name, slug, companies: byTheme.get(name) }))
  .filter((theme) => theme.companies.length >= minimum);
mkdirSync(join(site, 'themes'), { recursive: true });
for (const theme of active) {
  const url = `${origin}/themes/${theme.slug}.html`;
  const title = `${theme.name}を中期経営計画で掲げる企業一覧｜Chu-kei Insight`;
  const description = `${theme.name}に分類される中期経営計画の掲載企業${theme.companies.length}社を一覧。企業名・市場・業種・計画公表日・概要・指標件数を掲載。`;
  const cards = theme.companies.map((c) => {
    const d = detail(c);
    const summary = excerpt(text(d?.summary) || c.summary);
    const market = text(marketLabels[c.market] || c.market) || '未確認';
    const industry = text(c.industry) || '未確認';
    const published = text(c.planPublishedDate) || '未確認';
    return `<article class="company-card">
<h3><a href="/company/${encodeURIComponent(String(c.code))}.html">${esc(text(c.name) || '未確認')}（${esc(c.code)}）</a></h3>
<p class="meta">市場：${esc(market)} / 業種：${esc(industry)} / 中計公表日：${esc(published)} / 指標件数：${c.metricCount}件</p>
<p class="summary">${esc(summary)}</p>
</article>`;
  });
  const main = `<p class="eyebrow">戦略テーマ別企業一覧</p>
<h1>${esc(theme.name)}を中期経営計画で掲げる企業一覧</h1>
<p class="section-description">${esc(description)}</p>
<p><strong>該当企業数：${theme.companies.length}社</strong>（証券コード順）</p>
<div class="company-grid">${cards.join('\n')}</div>
<p>本一覧は既存のテーマ分類に基づく情報整理であり、取組の水準や投資価値を評価するものではありません。</p>`;
  writeFileSync(join(site, 'themes', `${theme.slug}.html`), shell(title, description, url, main,
    [['トップ', `${origin}/`], ['テーマ一覧', `${origin}/themes.html`], [theme.name, url]]));
}
// 計画変更で閾値を下回ったテーマの古い生成HTMLは残さない。
const live = new Set(active.map((t) => t.slug));
for (const [, slug] of themes) {
  const path = join(site, 'themes', `${slug}.html`);
  if (!live.has(slug) && existsSync(path)) unlinkSync(path);
}
const listTitle = '中期経営計画のテーマ別企業一覧｜Chu-kei Insight';
const listDesc = `中期経営計画で分類された${active.length}テーマから企業を探せます。各テーマに15社以上の企業を掲載しています。`;
const listMain = `<p class="eyebrow">テーマから探す</p><h1>中期経営計画のテーマ別企業一覧</h1>
<p class="section-description">${esc(listDesc)}</p>
<div class="company-grid">${active.map((t) => `<article class="company-card"><h2><a href="/themes/${t.slug}.html">${esc(t.name)}</a></h2><p class="meta">${t.companies.length}社</p></article>`).join('\n')}</div>
<p>該当数は現行・期限終了の計画を持つ登録企業のテーマ分類から集計しています。1社に複数のテーマが登録される場合があります。</p>`;
writeFileSync(join(site, 'themes.html'), shell(listTitle, listDesc, `${origin}/themes.html`, listMain,
  [['トップ', `${origin}/`], ['テーマ一覧', `${origin}/themes.html`]]));

// sitemapの既存URLを維持し、テーマURL部分だけを毎回正確に差し替える。
const sitemapPath = join(site, 'sitemap.xml');
const old = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
const previous = [...old.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const withoutTheme = previous.filter((u) => u !== `${origin}/themes.html` && !u.startsWith(`${origin}/themes/`));
const companyUrls = withoutTheme.filter((u) => u.startsWith(`${origin}/company/`));
const coreUrls = withoutTheme.filter((u) => !u.startsWith(`${origin}/company/`));
const themeUrls = [`${origin}/themes.html`, ...active.map((t) => `${origin}/themes/${t.slug}.html`)];
const urls = [...new Set([...coreUrls, ...themeUrls, ...companyUrls])];
writeFileSync(sitemapPath, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`theme pages: ${active.length}, resolved companies: ${companies.length}, sitemap urls: ${urls.length}`);
