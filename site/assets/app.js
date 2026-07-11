import { prepareCompaniesForSearch, filterAndRankCompanies } from './search-core.js';
import { parseWorkspaceUrl, buildWorkspaceUrl } from './workspace-state.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE_KEY = 'chukei.savedCompanies.v1';
const state = {
  data: null,
  filtered: [],
  visible: 50,
  strategy: '',
  compare: new Set(),
  saved: new Set(),
  sort: 'relevance',
  savedOnly: false,
  currentCompany: '',
};
const stageLabels = { core: '本番', detailed_extracted: '詳細抽出済みβ', source_indexed: '一次確認β', jpx_indexed: 'カバレッジβ' };
const sortLabels = { relevance: '検索との関連順', quality: '品質の高い順', verified: '最終確認日の新しい順', code: '証券コード順' };
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
const strategyLabels = Object.fromEntries(strategies.map(([key, label]) => [key, label]));
const strategyKeys = new Set(strategies.map(([key]) => key));
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const stars = n => n ? `${'★'.repeat(n)}${'☆'.repeat(5 - n)} ${n}/5` : '算定対象外';
const nonempty = value => value && value !== '未抽出' && !String(value).startsWith('未抽出');
let toastTimer;

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

function loadSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(code => /^[0-9A-Z]{4}$/.test(String(code))) : []);
  } catch {
    return new Set();
  }
}

function persistSaved() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.saved].sort())); } catch { /* local storage may be unavailable */ }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  showToast(successMessage);
}

function workspaceValues(company = state.currentCompany) {
  return {
    query: $('#search').value,
    market: $('#market').value,
    stage: $('#stage').value,
    strategy: state.strategy,
    sort: state.sort,
    savedOnly: state.savedOnly,
    compare: state.compare,
    company,
  };
}

function workspaceRelativeUrl(company = state.currentCompany) {
  return buildWorkspaceUrl(location.href, workspaceValues(company));
}

function syncWorkspaceUrl(company = state.currentCompany) {
  history.replaceState(null, '', workspaceRelativeUrl(company));
}

function shareWorkspace(company = state.currentCompany, message = '調査リンクをコピーしました。') {
  const absolute = new URL(workspaceRelativeUrl(company), location.href).href;
  return copyText(absolute, message);
}

function renderStrategies() {
  const companies = state.data.companies;
  $('#strategy-grid').innerHTML = strategies.map(([key, label, description]) => {
    const count = companies.filter(c => c.flags?.[key]).length;
    return `<button class="strategy-card" type="button" data-strategy="${key}" aria-pressed="${state.strategy === key}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(description)}・${count}社</span></button>`;
  }).join('');
  $$('.strategy-card').forEach(button => button.addEventListener('click', () => {
    state.strategy = state.strategy === button.dataset.strategy ? '' : button.dataset.strategy;
    state.visible = 50;
    renderStrategies();
    applyFilters();
  }));
  $('#clear-strategy').hidden = !state.strategy;
}

function sortCompanies(companies) {
  const rows = [...companies];
  if (state.sort === 'quality') {
    return rows.sort((a, b) => (b.quality?.stars ?? 0) - (a.quality?.stars ?? 0)
      || (b.quality?.score ?? -1) - (a.quality?.score ?? -1)
      || String(a.code).localeCompare(String(b.code), 'ja'));
  }
  if (state.sort === 'verified') {
    return rows.sort((a, b) => String(b.lastVerifiedDate ?? '').localeCompare(String(a.lastVerifiedDate ?? ''))
      || (b.quality?.stars ?? 0) - (a.quality?.stars ?? 0)
      || String(a.code).localeCompare(String(b.code), 'ja'));
  }
  if (state.sort === 'code') return rows.sort((a, b) => String(a.code).localeCompare(String(b.code), 'ja'));
  return rows;
}

function applyFilters({ sync = true } = {}) {
  const filters = {
    query: $('#search').value,
    market: $('#market').value,
    stage: $('#stage').value,
    strategy: state.strategy,
  };
  let rows = filterAndRankCompanies(state.data.companies, filters);
  if (state.savedOnly) rows = rows.filter(company => state.saved.has(company.code));
  state.filtered = sortCompanies(rows);
  renderCompanies();
  renderActiveFilters();
  renderSavedSummary();
  if (sync) syncWorkspaceUrl();
}

function qualityText(company) { return `${stars(company.quality?.stars)} ${company.quality?.label || stageLabels[company.stage]}`; }
function metricCount(company) { return ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'].filter(key => nonempty(company[key])).length; }
function researchStatus(company) {
  if (!['core', 'detailed_extracted'].includes(company.stage)) return '詳細抽出前';
  const count = metricCount(company);
  return `構造化項目 ${count}/5${company.flags?.progress ? '・進捗接続済み' : ''}`;
}

function renderCompanies() {
  const list = state.filtered.slice(0, state.visible);
  const savedLabel = state.savedOnly ? '・保存企業のみ' : '';
  $('#result-summary').textContent = `${state.filtered.length}社が該当・${list.length}社を表示${savedLabel}`;
  $('#company-grid').innerHTML = list.map(company => {
    const saved = state.saved.has(company.code);
    const compared = state.compare.has(company.code);
    return `<article class="company-card">
      <div class="card-head"><div><span class="stage-badge">${escapeHtml(stageLabels[company.stage] || company.tier)}</span><h3>${escapeHtml(company.name)}</h3><div class="meta">${escapeHtml(company.code)}・${escapeHtml(company.market)}・${escapeHtml(company.industry)}</div></div><div class="card-tools"><button class="save-button" type="button" data-save="${escapeHtml(company.code)}" aria-pressed="${saved}" aria-label="${escapeHtml(company.name)}を${saved ? '保存から外す' : '保存する'}">${saved ? '保存済み' : '保存'}</button><div class="quality-meta">${escapeHtml(qualityText(company))}</div></div></div>
      <p class="summary">${escapeHtml(company.summary || '中計本文の詳細は未抽出です。')}</p>
      <div class="tags">${(company.themes || []).slice(0, 5).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="research-status"><span>${escapeHtml(researchStatus(company))}</span><span>資料公表日 ${escapeHtml(company.planPublishedDate || '未確認')}</span></div>
      <div class="meta">最終確認日: ${escapeHtml(company.lastVerifiedDate || '未確認')}</div>
      <div class="card-actions"><button class="secondary-button" type="button" data-detail="${escapeHtml(company.code)}">詳細を見る</button><button class="primary-button" type="button" data-compare="${escapeHtml(company.code)}" aria-pressed="${compared}">${compared ? '比較から外す' : '比較に追加'}</button></div>
    </article>`;
  }).join('') || `<div class="status-panel"><strong>${state.savedOnly && !state.saved.size ? '保存した企業はまだありません。' : '条件に一致する企業がありません。'}</strong><p>${state.savedOnly && !state.saved.size ? '企業カードの「保存」から調査候補を追加できます。' : '検索語や絞り込み条件を変更してください。'}</p></div>`;
  $('#load-more').hidden = state.visible >= state.filtered.length;
  $$('[data-detail]').forEach(button => button.addEventListener('click', () => openCompany(button.dataset.detail)));
  $$('[data-compare]').forEach(button => button.addEventListener('click', () => toggleCompare(button.dataset.compare)));
  $$('[data-save]').forEach(button => button.addEventListener('click', () => toggleSaved(button.dataset.save)));
}

function renderSavedSummary() {
  $('#saved-summary').textContent = `保存 ${state.saved.size}社`;
  $('#saved-summary').setAttribute('aria-pressed', String(state.savedOnly));
  $('#saved-only').checked = state.savedOnly;
}

function renderActiveFilters() {
  const filters = [];
  if ($('#search').value.trim()) filters.push(['query', `検索: ${$('#search').value.trim()}`]);
  if ($('#market').value) filters.push(['market', `市場: ${$('#market').value}`]);
  if ($('#stage').value) filters.push(['stage', `品質: ${stageLabels[$('#stage').value]}`]);
  if (state.strategy) filters.push(['strategy', `戦略: ${strategyLabels[state.strategy]}`]);
  if (state.sort !== 'relevance') filters.push(['sort', `並び: ${sortLabels[state.sort]}`]);
  if (state.savedOnly) filters.push(['saved', '保存企業のみ']);
  $('#active-filters').innerHTML = filters.length
    ? filters.map(([key, label]) => `<button class="filter-chip" type="button" data-clear-filter="${key}" aria-label="${escapeHtml(label)}を解除">${escapeHtml(label)} <span aria-hidden="true">×</span></button>`).join('')
    : '<span class="filter-empty">すべての企業を表示中</span>';
  $$('[data-clear-filter]').forEach(button => button.addEventListener('click', () => clearFilter(button.dataset.clearFilter)));
}

function clearFilter(key) {
  if (key === 'query') $('#search').value = '';
  if (key === 'market') $('#market').value = '';
  if (key === 'stage') $('#stage').value = '';
  if (key === 'strategy') { state.strategy = ''; renderStrategies(); }
  if (key === 'sort') { state.sort = 'relevance'; $('#sort').value = 'relevance'; }
  if (key === 'saved') state.savedOnly = false;
  state.visible = 50;
  applyFilters();
}

function companyByCode(code) { return state.data.companies.find(c => c.code === code); }

function renderCompanyDetail(company) {
  const metrics = [['売上目標', company.revenue], ['利益目標', company.profit], ['収益性', company.margin], ['資本効率', company.capital], ['株主還元', company.returnPolicy]];
  const saved = state.saved.has(company.code);
  $('#company-detail').innerHTML = `<article class="dialog-card"><div class="dialog-head"><div><p class="eyebrow">${escapeHtml(stageLabels[company.stage])}・${escapeHtml(company.code)}</p><h2>${escapeHtml(company.name)}</h2><p>${escapeHtml(company.document || '中計資料未特定')} ${company.period ? `／ ${escapeHtml(company.period)}` : ''}</p></div><button class="icon-button" data-close type="button" aria-label="閉じる">×</button></div>
    <div class="detail-actions"><button class="secondary-button" type="button" data-save-detail="${escapeHtml(company.code)}" aria-pressed="${saved}">${saved ? '保存済み' : '調査候補に保存'}</button><button class="text-button" type="button" data-share-company="${escapeHtml(company.code)}">この企業のリンクをコピー</button></div>
    <p>${escapeHtml(company.summary)}</p><div class="detail-grid"><div><dt>品質</dt><dd>${escapeHtml(qualityText(company))}</dd></div><div><dt>抽出状況</dt><dd>${escapeHtml(researchStatus(company))}</dd></div><div><dt>資料公表日</dt><dd>${escapeHtml(company.planPublishedDate || '未確認')}</dd></div><div><dt>最終確認日</dt><dd>${escapeHtml(company.lastVerifiedDate || '未確認')}</dd></div><div><dt>業種</dt><dd>${escapeHtml(company.industry)}</dd></div>${metrics.filter(([, value]) => nonempty(value)).map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</div>
    ${section('戦略テーマ', company.themes)}${section('主なポイント', company.highlights)}${section('確認上の注意', company.warnings)}${section('原文証跡', company.evidenceRefs)}
    <div class="detail-section">${company.sourceUrl ? `<a class="primary-button" href="${escapeHtml(company.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式資料を開く</a>` : '<p>公式中計資料は未特定です。</p>'}</div></article>`;
  $('[data-save-detail]', $('#company-dialog'))?.addEventListener('click', () => toggleSaved(company.code));
  $('[data-share-company]', $('#company-dialog'))?.addEventListener('click', () => shareWorkspace(company.code, '企業リンクをコピーしました。'));
}

function openCompany(code, { sync = true } = {}) {
  const company = companyByCode(code); if (!company) return;
  state.currentCompany = code;
  renderCompanyDetail(company);
  bindClose($('#company-dialog'), () => {
    state.currentCompany = '';
    syncWorkspaceUrl('');
  });
  if (!$('#company-dialog').open) $('#company-dialog').showModal();
  if (sync) syncWorkspaceUrl(code);
}

function section(title, items) { return items?.length ? `<section class="detail-section"><h3>${title}</h3><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : ''; }

function toggleSaved(code) {
  if (state.saved.has(code)) state.saved.delete(code); else state.saved.add(code);
  persistSaved();
  applyFilters();
  if ($('#company-dialog').open && state.currentCompany === code) renderCompanyDetail(companyByCode(code));
  showToast(state.saved.has(code) ? '調査候補に保存しました。' : '保存から外しました。');
}

function toggleCompare(code) {
  if (state.compare.has(code)) state.compare.delete(code);
  else if (state.compare.size < 4) state.compare.add(code);
  else { showToast('比較できるのは4社までです。'); return; }
  renderCompanies();
  renderCompareTray();
  syncWorkspaceUrl();
}

function renderCompareTray() {
  const companies = [...state.compare].map(companyByCode).filter(Boolean);
  $('#compare-tray').hidden = !companies.length;
  $('#compare-count').textContent = companies.length;
  $('#compare-names').textContent = companies.map(c => c.name).join('、');
}

function openCompare() {
  const companies = [...state.compare].map(companyByCode).filter(Boolean);
  if (companies.length < 2) { showToast('比較する企業を2社以上選択してください。'); return; }
  const rows = [
    ['データ品質', c => qualityText(c)],
    ['市場・業種', c => `${c.market}・${c.industry}`],
    ['中計・対象資料', c => c.document || '未特定'],
    ['計画期間', c => c.period || '未確認'],
    ['戦略テーマ', c => (c.themes || []).join('、')],
    ['概要', c => c.summary],
    ['売上目標', c => c.revenue],
    ['利益目標', c => c.profit],
    ['収益性', c => c.margin],
    ['資本効率', c => c.capital],
    ['株主還元', c => c.returnPolicy],
    ['進捗接続', c => c.flags?.progress ? '接続済み' : '未接続'],
    ['資料公表日', c => c.planPublishedDate || '未確認'],
    ['最終確認日', c => c.lastVerifiedDate || '未確認'],
  ];
  $('#compare-detail').innerHTML = `<article class="dialog-card"><div class="dialog-head"><div><p class="eyebrow">Company Comparison</p><h2>中計比較</h2><p>${companies.length}社の戦略・目標・資本政策を同じ軸で確認します。</p></div><button class="icon-button" data-close type="button" aria-label="閉じる">×</button></div><div class="detail-actions"><button class="text-button" type="button" data-share-compare-dialog>比較リンクをコピー</button></div><div class="compare-table-wrap" tabindex="0" role="region" aria-label="中計比較表"><table class="compare-table"><thead><tr><th scope="col">比較項目</th>${companies.map(c => `<th scope="col">${escapeHtml(c.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, getter]) => `<tr><th scope="row">${label}</th>${companies.map(c => `<td>${escapeHtml(getter(c) || '未抽出')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></article>`;
  $('[data-share-compare-dialog]', $('#compare-dialog'))?.addEventListener('click', () => shareWorkspace('', '比較リンクをコピーしました。'));
  bindClose($('#compare-dialog'));
  $('#compare-dialog').showModal();
}

function bindClose(dialog, onClose) {
  $('[data-close]', dialog)?.addEventListener('click', () => dialog.close());
  dialog.onclick = event => { if (event.target === dialog) dialog.close(); };
  dialog.onclose = () => onClose?.();
}

function updateStats() {
  const companies = state.data.companies;
  $('#stat-total').textContent = `${companies.length}社`;
  $('#stat-confirmed').textContent = `${companies.filter(c => c.stage !== 'jpx_indexed').length}社`;
  $('#stat-structured').textContent = `${companies.filter(c => ['core', 'detailed_extracted'].includes(c.stage)).length}社`;
  $('#stat-progress').textContent = `${state.data.progress.length}件`;
}

function restoreWorkspace(validCodes) {
  const restored = parseWorkspaceUrl(location.href, { validStrategies: strategyKeys, validCodes });
  $('#search').value = restored.query;
  $('#market').value = restored.market;
  $('#stage').value = restored.stage;
  $('#sort').value = restored.sort;
  state.strategy = restored.strategy;
  state.sort = restored.sort;
  state.savedOnly = restored.savedOnly;
  state.compare = new Set(restored.compare);
  state.currentCompany = restored.company;
}

async function init() {
  try {
    state.saved = loadSaved();
    state.data = await loadData();
    state.data.companies = prepareCompaniesForSearch(state.data.companies);
    const validCodes = new Set(state.data.companies.map(company => company.code));
    state.saved = new Set([...state.saved].filter(code => validCodes.has(code)));
    persistSaved();
    restoreWorkspace(validCodes);
    updateStats();
    renderStrategies();
    applyFilters({ sync: false });
    renderCompareTray();
    renderSavedSummary();
    $('#loading').hidden = true;
    if (state.currentCompany) openCompany(state.currentCompany, { sync: false });
    syncWorkspaceUrl();
  } catch (error) {
    $('#loading').hidden = true;
    $('#error').hidden = false;
    $('#error').textContent = `データを読み込めませんでした: ${error.message}`;
    console.error(error);
  }
}

$('#filters').addEventListener('input', () => {
  state.visible = 50;
  state.sort = $('#sort').value;
  state.savedOnly = $('#saved-only').checked;
  applyFilters();
});
$('#filters').addEventListener('reset', () => setTimeout(() => {
  state.strategy = '';
  state.sort = 'relevance';
  state.savedOnly = false;
  state.visible = 50;
  renderStrategies();
  applyFilters();
}, 0));
$('#clear-strategy').addEventListener('click', () => { state.strategy = ''; renderStrategies(); applyFilters(); });
$('#load-more').addEventListener('click', () => { state.visible += 50; renderCompanies(); });
$('#clear-compare').addEventListener('click', () => { state.compare.clear(); renderCompanies(); renderCompareTray(); syncWorkspaceUrl(); });
$('#open-compare').addEventListener('click', openCompare);
$('#share-compare').addEventListener('click', () => state.compare.size >= 2 ? shareWorkspace('', '比較リンクをコピーしました。') : showToast('比較する企業を2社以上選択してください。'));
$('#share-workspace').addEventListener('click', () => shareWorkspace());
$('#share-workspace-top').addEventListener('click', () => shareWorkspace());
$('#saved-summary').addEventListener('click', () => {
  if (!state.saved.size) { showToast('企業カードの「保存」から調査候補を追加できます。'); return; }
  state.savedOnly = !state.savedOnly;
  state.visible = 50;
  applyFilters();
  $('#directory-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#open-quality').addEventListener('click', () => { bindClose($('#quality-dialog')); $('#quality-dialog').showModal(); });
init();
