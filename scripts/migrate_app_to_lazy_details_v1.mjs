import fs from 'node:fs';
import path from 'node:path';

const APP_PATH = path.resolve('site/assets/app.js');
let source = fs.readFileSync(APP_PATH, 'utf8');

const replaceOnce = (before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  source = source.replace(before, after);
};

replaceOnce(
  "import { parseWorkspaceUrl, buildWorkspaceUrl } from './workspace-state.js';\n",
  "import { parseWorkspaceUrl, buildWorkspaceUrl } from './workspace-state.js';\nimport { loadFrontendData, loadCompanyDetail } from './frontend-data-loader.js';\n",
  'loader import',
);

replaceOnce(
  "  currentCompany: '',\n};",
  "  currentCompany: '',\n  currentDetail: null,\n};",
  'detail state',
);

replaceOnce(
`async function loadData() {
  if (!('DecompressionStream' in window)) throw new Error('このブラウザは圧縮データの展開に対応していません。最新版のブラウザでお試しください。');
  const manifest = await fetch('./data/bundle.manifest.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('データマニフェストを取得できません。'); return r.json(); });
  const buffers = await Promise.all(manifest.parts.map(part => fetch(\`./data/\${part.file}\`).then(r => { if (!r.ok) throw new Error(\`\${part.file}を取得できません。\`); return r.arrayBuffer(); })));
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
`,
  "const loadData = loadFrontendData;\n",
  'monolithic loader',
);

replaceOnce(
  "function metricCount(company) { return ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'].filter(key => nonempty(company[key])).length; }",
  "function metricCount(company) { return company.metricCount ?? ['revenue', 'profit', 'margin', 'capital', 'returnPolicy'].filter(key => nonempty(company[key])).length; }",
  'metric count',
);

replaceOnce(
  "function companyByCode(code) { return state.data.companies.find(c => c.code === code); }",
  "function companyByCode(code) { return state.data.companies.find(c => c.code === code); }\nasync function companyDetailByCode(code) {\n  const company = companyByCode(code);\n  return company ? loadCompanyDetail(company) : null;\n}",
  'detail lookup',
);

replaceOnce(
`function openCompany(code, { sync = true } = {}) {
  const company = companyByCode(code); if (!company) return;
  state.currentCompany = code;
  renderCompanyDetail(company);
  bindClose($('#company-dialog'), () => {
    state.currentCompany = '';
    syncWorkspaceUrl('');
  });
  if (!$('#company-dialog').open) $('#company-dialog').showModal();
  if (sync) syncWorkspaceUrl(code);
}`,
`async function openCompany(code, { sync = true } = {}) {
  const indexCompany = companyByCode(code); if (!indexCompany) return;
  const dialog = $('#company-dialog');
  state.currentCompany = code;
  state.currentDetail = null;
  $('#company-detail').innerHTML = \`<article class="dialog-card"><div class="dialog-head"><div><p class="eyebrow">Company Detail</p><h2>\${escapeHtml(indexCompany.name)}</h2><p>詳細データを読み込んでいます…</p></div><button class="icon-button" data-close type="button" aria-label="閉じる">×</button></div></article>\`;
  const onClose = () => {
    state.currentCompany = '';
    state.currentDetail = null;
    syncWorkspaceUrl('');
  };
  bindClose(dialog, onClose);
  if (!dialog.open) dialog.showModal();
  if (sync) syncWorkspaceUrl(code);
  try {
    const company = await loadCompanyDetail(indexCompany);
    if (state.currentCompany !== code) return;
    state.currentDetail = company;
    renderCompanyDetail(company);
    bindClose(dialog, onClose);
  } catch (error) {
    if (state.currentCompany !== code) return;
    $('#company-detail').innerHTML = \`<article class="dialog-card"><div class="dialog-head"><div><p class="eyebrow">Load Error</p><h2>\${escapeHtml(indexCompany.name)}</h2></div><button class="icon-button" data-close type="button" aria-label="閉じる">×</button></div><p>詳細データを読み込めませんでした: \${escapeHtml(error.message)}</p><button class="secondary-button" type="button" data-retry-detail>再試行</button></article>\`;
    bindClose(dialog, onClose);
    $('[data-retry-detail]', dialog)?.addEventListener('click', () => openCompany(code, { sync: false }));
    console.error(error);
  }
}`,
  'open company',
);

replaceOnce(
  "  if ($('#company-dialog').open && state.currentCompany === code) renderCompanyDetail(companyByCode(code));",
  "  if ($('#company-dialog').open && state.currentCompany === code && state.currentDetail) { renderCompanyDetail(state.currentDetail); bindClose($('#company-dialog'), () => { state.currentCompany = ''; state.currentDetail = null; syncWorkspaceUrl(''); }); }",
  'saved detail refresh',
);

replaceOnce(
  "function openCompare() {\n  const companies = [...state.compare].map(companyByCode).filter(Boolean);",
  "async function openCompare() {\n  const companies = (await Promise.all([...state.compare].map(code => companyDetailByCode(code).catch(error => { console.error(error); return null; })))).filter(Boolean);",
  'compare lazy loading',
);

replaceOnce(
  "    if (state.currentCompany) openCompany(state.currentCompany, { sync: false });",
  "    if (state.currentCompany) await openCompany(state.currentCompany, { sync: false });",
  'workspace detail restore',
);

fs.writeFileSync(APP_PATH, source);
console.log('Migrated site/assets/app.js to lazy company detail loading.');
