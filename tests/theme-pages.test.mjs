import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const slugs = ['human-capital', 'sustainability', 'shareholder-return', 'capital-efficiency', 'overseas', 'dx', 'ai', 'business-growth', 'productivity', 'ma', 'products-services', 'capex', 'restructuring', 'business-portfolio', 'rd'];
const names = ['人的資本', 'サステナビリティ', '株主還元', '資本効率', '海外', 'DX', 'AI', '事業成長', '生産性', 'M&A', '商品・サービス', '設備投資', '事業再編', '事業ポートフォリオ', '研究開発'];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chu-kei-theme-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'site/data/frontend'), { recursive: true });
  cpSync(join(repo, 'scripts/build_theme_pages_v1.mjs'), join(dir, 'scripts/build_theme_pages_v1.mjs'));
  cpSync(join(repo, 'scripts/build_company_pages_v1.mjs'), join(dir, 'scripts/build_company_pages_v1.mjs'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  const companies = Array.from({ length: 16 }, (_, i) => ({
    code: String(1000 + i), name: i === 0 ? '<危険&社>' : `企業${i}`,
    market: 'Prime', industry: '機械', planStatus: i === 15 ? 'expired' : 'current',
    planPublishedDate: '2026-05-01', metricCount: i,
    themes: i === 0 ? [...names, names[0]] : names,
    summary: i === 0 ? '<script>alert(1)</script>' : `公開概要${i}`,
  }));
  companies.push({ code: '9999', name: '除外社', market: 'Prime', planStatus: 'no_formal_plan', metricCount: 999, themes: names });
  writeFileSync(join(dir, 'site/data/frontend/company-index.json.gz'), gzipSync(JSON.stringify({ companies })));
  writeFileSync(join(dir, 'site/sitemap.xml'), '<?xml version="1.0"?><urlset><url><loc>https://chu-kei.com/</loc></url><url><loc>https://chu-kei.com/quality.html</loc></url></urlset>');
  return dir;
}
function execute(dir, script) {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', script)], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `${script}\n${r.stdout}\n${r.stderr}`);
}
function urls(dir) {
  return [...readFileSync(join(dir, 'site/sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

test('15テーマを生成し、resolvedのみ集計・metricCount正本を転記する', () => {
  const dir = fixture();
  try {
    execute(dir, 'build_theme_pages_v1.mjs');
    const list = readFileSync(join(dir, 'site/themes.html'), 'utf8');
    assert.match(list, /人的資本/);
    for (const slug of slugs) assert.ok(existsSync(join(dir, `site/themes/${slug}.html`)), slug);
    const html = readFileSync(join(dir, 'site/themes/human-capital.html'), 'utf8');
    assert.match(html, /該当企業数：16社/);
    assert.match(html, /theme-company-card/);
    assert.match(html, /theme-company-code/);
    assert.ok(html.indexOf('/company/1014.html') < html.indexOf('/company/1015.html'));
    assert.match(html, /指標件数：0件/);
    assert.match(html, /指標件数：15件/);
    assert.ok(!html.includes('除外社'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal((html.match(/href="\/company\/1000.html"/g) || []).length, 1);
    assert.ok(html.indexOf('/company/1000.html') < html.indexOf('/company/1001.html'));
    const all = urls(dir);
    assert.equal(all.length, 18);
    assert.equal(new Set(all).size, 18);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('企業ページ生成後もテーマURLが消えず、再実行でもsitemapが変化しない', () => {
  const dir = fixture();
  try {
    execute(dir, 'build_theme_pages_v1.mjs');
    execute(dir, 'build_company_pages_v1.mjs');
    const html = readFileSync(join(dir, 'site/company/1000.html'), 'utf8');
    assert.match(html, /\/themes\/human-capital.html/);
    assert.match(html, /\/themes\/ma.html/);
    // P0（2026-11-21）で会社詳細ページは共通 styles.css を読み込む仕様に変更された
    assert.ok(html.includes('<link rel="stylesheet" href="/assets/styles.css">'));
    const sitemap = readFileSync(join(dir, 'site/sitemap.xml'), 'utf8');
    // 内訳: 基幹2 + テーマ16 + 企業17（企業側は既存仕様で no_formal_plan も生成対象）
    assert.equal(urls(dir).length, 35);
    execute(dir, 'build_theme_pages_v1.mjs');
    execute(dir, 'build_company_pages_v1.mjs');
    assert.equal(readFileSync(join(dir, 'site/sitemap.xml'), 'utf8'), sitemap);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('閾値を下回ったテーマは出力とsitemapから削除し、リンクしない', () => {
  const dir = fixture();
  try {
    execute(dir, 'build_theme_pages_v1.mjs');
    const path = join(dir, 'site/data/frontend/company-index.json.gz');
    const input = JSON.parse((gunzipSync(readFileSync(path))).toString('utf8'));
    for (const c of input.companies) c.themes = c.themes.filter((t) => t !== '研究開発');
    writeFileSync(path, gzipSync(JSON.stringify(input)));
    execute(dir, 'build_theme_pages_v1.mjs');
    execute(dir, 'build_company_pages_v1.mjs');
    assert.ok(!existsSync(join(dir, 'site/themes/rd.html')));
    assert.ok(!urls(dir).includes('https://chu-kei.com/themes/rd.html'));
    assert.ok(!readFileSync(join(dir, 'site/company/1000.html'), 'utf8').includes('/themes/rd.html'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

