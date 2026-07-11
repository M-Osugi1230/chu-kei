import {
  LEGACY_SAVED_KEY,
  loadSavedResearch,
  persistSavedResearch,
  syncSavedResearch,
  hasSavedUpdate,
  markSavedSeen,
  countSavedUpdates,
} from './saved-research-state.js';
import { buildProgressIndex, progressForCode, progressSummary } from './progress-view.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const stars = value => value ? `${'★'.repeat(value)}${'☆'.repeat(5 - value)} ${value}/5` : '算定対象外';
const stageLabels = { core: '本番', detailed_extracted: '詳細抽出済みβ', source_indexed: '一次確認β', jpx_indexed: 'カバレッジβ' };
let companyByCode = new Map();
let progressIndex = new Map();
let metadata = new Map();
let ready = false;

function legacyCodes() {
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_SAVED_KEY) || '[]');
    return Array.isArray(value) ? value.map(code => String(code).toUpperCase()) : [];
  } catch {
    return [];
  }
}

function navigateWith({ company = '', savedOnly = false, compare = [] } = {}) {
  const url = new URL(location.href);
  if (savedOnly) url.searchParams.set('saved', '1');
  else url.searchParams.delete('saved');
  if (compare.length) url.searchParams.set('compare', compare.slice(0, 4).join(','));
  else url.searchParams.delete('compare');
  url.hash = company ? `company=${encodeURIComponent(company)}` : '';
  location.href = `${url.pathname}${url.search}${url.hash}`;
}

function savedCompanies() {
  return [...metadata.keys()].map(code => companyByCode.get(code)).filter(Boolean);
}

function sortedSavedCompanies() {
  return savedCompanies().sort((left, right) => {
    const leftUpdate = Number(hasSavedUpdate(metadata.get(left.code), left));
    const rightUpdate = Number(hasSavedUpdate(metadata.get(right.code), right));
    return rightUpdate - leftUpdate
      || (right.quality?.stars ?? 0) - (left.quality?.stars ?? 0)
      || String(right.lastVerifiedDate ?? '').localeCompare(String(left.lastVerifiedDate ?? ''))
      || left.code.localeCompare(right.code, 'ja');
  });
}

function render() {
  if (!ready) return;
  metadata = syncSavedResearch(metadata, legacyCodes(), companyByCode);
  persistSavedResearch(localStorage, metadata);
  const rows = sortedSavedCompanies();
  const section = $('#saved-research-shelf');
  section.hidden = rows.length === 0;
  if (!rows.length) return;

  const updateCount = countSavedUpdates(metadata, companyByCode);
  const progressCompanies = rows.filter(company => progressForCode(progressIndex, company.code).length > 0).length;
  $('#saved-shelf-summary').textContent = `保存 ${rows.length}社・更新あり ${updateCount}社・進捗データ接続 ${progressCompanies}社。保存後に最終確認日が進んだ企業を先頭に表示します。`;
  $('#mark-saved-seen').hidden = updateCount === 0;
  $('#compare-saved').disabled = rows.length < 2;
  $('#compare-saved').textContent = rows.length >= 2 ? `先頭${Math.min(rows.length, 4)}社を比較` : '比較には2社必要';

  $('#saved-shelf-grid').innerHTML = rows.slice(0, 6).map(company => {
    const updated = hasSavedUpdate(metadata.get(company.code), company);
    const progress = progressSummary(progressForCode(progressIndex, company.code));
    return `<article class="saved-shelf-card ${updated ? 'has-update' : ''}">
      <div class="saved-shelf-card-head"><div><span class="stage-badge">${escapeHtml(stageLabels[company.stage] || company.tier)}</span><h3>${escapeHtml(company.name)}</h3><p>${escapeHtml(company.code)}・${escapeHtml(company.market)}・${escapeHtml(company.industry)}</p></div>${updated ? '<span class="update-badge">更新あり</span>' : '<span class="seen-badge">確認済み</span>'}</div>
      <dl><div><dt>品質</dt><dd>${escapeHtml(stars(company.quality?.stars))}</dd></div><div><dt>進捗</dt><dd>${escapeHtml(progress)}</dd></div><div><dt>最終確認日</dt><dd>${escapeHtml(company.lastVerifiedDate || '未確認')}</dd></div></dl>
      <button class="secondary-button" type="button" data-shelf-detail="${escapeHtml(company.code)}">調査を再開</button>
    </article>`;
  }).join('');

  document.querySelectorAll('[data-shelf-detail]').forEach(button => button.addEventListener('click', () => {
    const company = companyByCode.get(button.dataset.shelfDetail);
    if (company && markSavedSeen(metadata, company)) persistSavedResearch(localStorage, metadata);
    navigateWith({ company: button.dataset.shelfDetail });
  }));
}

function refreshAfterAppMutation() {
  setTimeout(render, 0);
}

function markOneSeen(code) {
  const company = companyByCode.get(code);
  if (!company || !metadata.has(code)) return;
  if (markSavedSeen(metadata, company)) persistSavedResearch(localStorage, metadata);
  render();
}

function initialize(data) {
  if (ready || !data) return;
  companyByCode = new Map((data.companies ?? []).map(company => [String(company.code), company]));
  progressIndex = buildProgressIndex(data.progress ?? []);
  metadata = loadSavedResearch(localStorage, companyByCode);
  persistSavedResearch(localStorage, metadata);
  ready = true;
  render();
}

document.addEventListener('click', event => {
  const saveButton = event.target.closest('[data-save],[data-save-detail]');
  if (saveButton) refreshAfterAppMutation();
  const detailButton = event.target.closest('[data-detail]');
  if (detailButton) markOneSeen(detailButton.dataset.detail);
});

$('#show-saved-results').addEventListener('click', () => navigateWith({ savedOnly: true }));
$('#compare-saved').addEventListener('click', () => {
  const codes = sortedSavedCompanies().map(company => company.code).slice(0, 4);
  if (codes.length >= 2) navigateWith({ compare: codes });
});
$('#mark-saved-seen').addEventListener('click', () => {
  for (const company of savedCompanies()) markSavedSeen(metadata, company);
  persistSavedResearch(localStorage, metadata);
  render();
});

const bridge = globalThis.ChuKeiDataBridge;
if (!bridge?.ready) {
  console.error('保存した調査候補を初期化できませんでした。');
} else {
  initialize(bridge.current?.());
  bridge.ready.then(initialize).catch(error => console.error('保存した調査候補を読み込めませんでした。', error));
}
