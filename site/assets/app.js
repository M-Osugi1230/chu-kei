const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { data: null, filtered: [], visible: 50, strategy: '', compare: new Set() };
const stageLabels = { core: '本番', detailed_extracted: '詳細抽出済みβ', source_indexed: '一次確認β', jpx_indexed: 'カバレッジβ' };
const strategies = [
  ['ma', 'M&A活用型', '買収・提携を成長手段として明示'],
  ['capitalEfficiency', '資本効率・ROIC型', 'ROIC・ROE・資本コストを重視'],
  ['shareholderReturn', '株主還元強化型', '配当・DOE・自己株式取得を明示'],
  ['overseas', '海外展開型', '海外市場・海外売上の拡大'],
  ['dx', 'DX・AI推進型', 'デジタル・AIを戦略に組み込む'],
  ['humanCapital', '人材投資型', '人的資本・組織能力を重視'],
  ['newBusiness', '新規事業型', '新しい収益源・事業創出を掲げる'],
  ['restructuring', '構造改革型', '事業再編・収益構造の転換'],
  ['progress', '進捗接続済み', '目標値と実績を接続して確認可能'],
];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const stars = n => n ? `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` : '算定対象外';
const nonempty = value => value && value !== '未抽出' && !String(value).startsWith('未抽出');

async function loadData() {
  if (!('DecompressionStream' in window)) throw new Error('このブラウザは圧縮データの展開に対応していません。最新版のブラウザでお試しください。');
  const manifest = await fetch('./data/bundle.manifest.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('データマニフェストを取得できません。'); return r.json(); });
  const buffers = await Promise.all(manifest.parts.map(part => fetch(`./data/${part.file}`).then(r => { if (!r.ok) throw new Error(`${part.file}を取得できません。`); return r.arrayBuffer(); })));
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const bytes = new Uint8Array(total); let offset = 0;
  for (const buffer of buffers) { bytes.set(new Uint8Array(buffer), offset); offset += buffer.byteLength; }
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== manifest.sha256) throw new Error('データ整合性の確認に失敗しました。');
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const data = JSON.parse(text);
  if (data.companies.length !== manifest.companyCount || data.progress.length !== manifest.progressCount) throw new Error('データ件数がマニフェストと一致しません。');
  return data;
}

function renderStrategies() {
  const companies = state.data.companies;
  $('#strategy-grid').innerHTML = strategies.map(([key, label, description]) => {
    const count = companies.filter(c => c.flags?.[key]).length;
    return `<button class="strategy-card" type="button" role="listitem" data-strategy="${key}" aria-pressed="${state.strategy === key}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(description)}・${count}社</span></button>`;
  }).join('');
  $$('.strategy-card').forEach(button => button.addEventListener('click', () => {
    state.strategy = state.strategy === button.dataset.strategy ? '' : button.dataset.strategy;
    state.visible = 50; renderStrategies(); applyFilters();
  }));
  $('#clear-strategy').hidden = !state.strategy;
}

function searchable(company) {
  return [company.code, company.name, company.market, company.industry, company.category, company.summary, company.document, ...(company.themes || [])].join(' ').toLowerCase();
}
function applyFilters() {
  const query = $('#search').value.trim().toLowerCase();
  const market = $('#market').value;
  const stage = $('#stage').value;
  state.filtered = state.data.companies.filter(company => (!query || searchable(company).includes(query)) && (!market || company.market === market) && (!stage || company.stage === stage) && (!state.strategy || company.flags?.[state.strategy]));
  renderCompanies();
}
function qualityText(company) { return `${stars(company.quality?.stars)} ${company.quality?.label || stageLabels[company.stage]}`; }
function renderCompanies() {
  const list = state.filtered.slice(0, state.visible);
  $('#result-summary').textContent = `${state.filtered.length}社が該当・${list.length}社を表示`;
  $('#company-grid').innerHTML = list.map(company => `<article class="company-card">
    <div class="card-head"><div><span class="stage-badge">${escapeHtml(stageLabels[company.stage] || company.tier)}</span><h3>${escapeHtml(company.name)}</h3><div class="meta">${escapeHtml(company.code)}・${escapeHtml(company.market)}・${escapeHtml(company.industry)}</div></div><div class="quality-meta">${escapeHtml(qualityText(company))}</div></div>
    <p class="summary">${escapeHtml(company.summary || '中計本文の詳細は未抽出です。')}</p>
    <div class="tags">${(company.themes || []).slice(0, 5).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    <div class="meta">資料公表日: ${escapeHtml(company.planPublishedDate || '未確認')} ／ 最終確認日: ${escapeHtml(company.lastVerifiedDate || '未確認')}</div>
    <div class="card-actions"><button class="secondary-button" type="button" data-detail="${escapeHtml(company.code)}">詳細を見る</button><button class="primary-button" type="button" data-compare="${escapeHtml(company.code)}" aria-pressed="${state.compare.has(company.code)}">${state.compare.has(company.code) ? '比較から外す' : '比較に追加'}</button></div>
  </article>`).join('') || '<div class="status-panel">条件に一致する企業がありません。検索条件を変更してください。</div>';
  $('#load-more').hidden = state.visible >= state.filtered.length;
  $$('[data-detail]').forEach(b => b.addEventListener('click', () => openCompany(b.dataset.detail)));
  $$('[data-compare]').forEach(b => b.addEventListener('click', () => toggleCompare(b.dataset.compare)));
}
function companyByCode(code) { return state.data.companies.find(c => c.code === code); }
function openCompany(code) {
  const c = companyByCode(code); if (!c) return;
  const metrics = [['売上目標', c.revenue], ['利益目標', c.profit], ['収益性', c.margin], ['資本効率', c.capital], ['株主還元', c.returnPolicy]];
  $('#company-detail').innerHTML = `<article class="dialog-card"><div class="dialog-head"><div><p class="eyebrow">${escapeHtml(stageLabels[c.stage])}・${escapeHtml(c.code)}</p><h2>${escapeHtml(c.name)}</h2><p>${escapeHtml(c.document || '中計資料未特定')} ${c.period ? `／ ${escapeHtml(c.period)}` : ''}</p></div><button class="icon-button" data-close type="button" aria-label="閉じる">×</button></div>
    <p>${escapeHtml(c.summary)}</p><div class="detail-grid"><div><dt>品質</dt><dd>${escapeHtml(qualityText(c))}</dd></div><div><dt>資料公表日</dt><dd>${escapeHtml(c.planPublishedDate || '未確認')}</dd></div><div><dt>最終確認日</dt><dd>${escapeHtml(c.lastVerifiedDate || '未確認')}</dd></div><div><dt>業種</dt><dd>${escapeHtml(c.industry)}</dd></div>${metrics.filter(([,v]) => nonempty(v)).map(([k,v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</div>
    ${section('主なポイント', c.highlights)}${section('確認上の注意', c.warnings)}${section('原文証跡', c.evidenceRefs)}
    <div class="detail-section">${c.sourceUrl ? `<a class="primary-button" href="${escapeHtml(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式資料を開く</a>` : '<p>公式中計資料は未特定です。</p>'}</div></article>`;
  bindClose($('#company-dialog')); $('#company-dialog').showModal(); history.replaceState(null, '', `#company=${encodeURIComponent(code)}`);
}
function section(title, items) { return items?.length ? `<section class="detail-section"><h3>${title}</h3><ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></section>` : ''; }
function toggleCompare(code) {
  if (state.compare.has(code)) state.compare.delete(code); else if (state.compare.size < 4) state.compare.add(code); else { alert('比較できるのは4社までです。'); return; }
  renderCompanies(); renderCompareTray();
}
function renderCompareTray() {
  const companies = [...state.compare].map(companyByCode).filter(Boolean);
  $('#compare-tray').hidden = !companies.length; $('#compare-count').textContent = companies.length; $('#compare-names').textContent = companies.map(c => c.name).join('、');
}
function openCompare() {
  const companies = [...state.compare].map(companyByCode).filter(Boolean); if (companies.length < 2) { alert('2社以上を選択してください。'); return; }
  const rows = [['データ品質', c => qualityText(c)], ['市場・業種', c => `${c.market}・${c.industry}`], ['中計・対象資料', c => c.document || '未特定'], ['計画期間', c => c.period || '未確認'], ['概要', c => c.summary], ['売上目標', c => c.revenue], ['利益目標', c => c.profit], ['収益性', c => c.margin], ['資本効率', c => c.capital], ['株主還元', c => c.returnPolicy], ['資料公表日', c => c.planPublishedDate || '未確認'], ['最終確認日', c => c.lastVerifiedDate || '未確認']];
  $('#compare-detail').innerHTML = `<article class="dialog-card"><div class="dialog-head"><div><p class="eyebrow">Company Comparison</p><h2>中計比較</h2></div><button class="icon-button" data-close type="button" aria-label="閉じる">×</button></div><div class="compare-table-wrap"><table class="compare-table"><thead><tr><th scope="col">比較項目</th>${companies.map(c => `<th scope="col">${escapeHtml(c.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, getter]) => `<tr><th scope="row">${label}</th>${companies.map(c => `<td>${escapeHtml(getter(c) || '未抽出')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></article>`;
  bindClose($('#compare-dialog')); $('#compare-dialog').showModal();
}
function bindClose(dialog) { $('[data-close]', dialog)?.addEventListener('click', () => dialog.close()); dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }, { once: true }); }
function updateStats() {
  const companies = state.data.companies;
  $('#stat-total').textContent = `${companies.length}社`;
  $('#stat-confirmed').textContent = `${companies.filter(c => c.stage !== 'jpx_indexed').length}社`;
  $('#stat-structured').textContent = `${companies.filter(c => ['core','detailed_extracted'].includes(c.stage)).length}社`;
  $('#stat-progress').textContent = `${state.data.progress.length}件`;
}
async function init() {
  try {
    state.data = await loadData(); state.filtered = state.data.companies; updateStats(); renderStrategies(); applyFilters(); $('#loading').hidden = true;
    const code = new URLSearchParams(location.hash.replace(/^#/, '')).get('company'); if (code) openCompany(code);
  } catch (error) { $('#loading').hidden = true; $('#error').hidden = false; $('#error').textContent = `データを読み込めませんでした: ${error.message}`; console.error(error); }
}
$('#filters').addEventListener('input', () => { state.visible = 50; applyFilters(); });
$('#filters').addEventListener('reset', () => setTimeout(() => { state.strategy = ''; state.visible = 50; renderStrategies(); applyFilters(); }, 0));
$('#clear-strategy').addEventListener('click', () => { state.strategy = ''; renderStrategies(); applyFilters(); });
$('#load-more').addEventListener('click', () => { state.visible += 50; renderCompanies(); });
$('#clear-compare').addEventListener('click', () => { state.compare.clear(); renderCompanies(); renderCompareTray(); });
$('#open-compare').addEventListener('click', openCompare);
$('#open-quality').addEventListener('click', () => { bindClose($('#quality-dialog')); $('#quality-dialog').showModal(); });
init();
