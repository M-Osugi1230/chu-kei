const filters = document.querySelector('#filters');
const loading = document.querySelector('#loading');
const errorPanel = document.querySelector('#error');
const directory = document.querySelector('#directory-title');
const status = document.querySelector('#preset-status');
const presetButtons = [...document.querySelectorAll('[data-workspace-preset]')];

const presets = {
  quality: {
    stage: 'core',
    sort: 'quality',
    strategy: '',
    message: '本番データに絞り、品質の高い順で表示しました。',
  },
  progress: {
    stage: '',
    sort: 'verified',
    strategy: 'progress',
    message: '中計目標と実績を接続済みの企業を、確認日の新しい順で表示しました。',
  },
  ma: {
    stage: 'core',
    sort: 'quality',
    strategy: 'ma',
    message: '本番データのうち、M&A・提携を成長手段として示す企業を表示しました。',
  },
  recent: {
    stage: '',
    sort: 'verified',
    strategy: '',
    message: '全企業を、最終確認日の新しい順で表示しました。',
  },
};

function workspaceReady() {
  return Boolean(
    filters
    && loading?.hidden
    && errorPanel?.hidden
    && document.querySelector('.strategy-card'),
  );
}

function updatePresetAvailability() {
  const ready = workspaceReady();
  presetButtons.forEach(button => {
    button.disabled = !ready;
    button.setAttribute('aria-disabled', String(!ready));
  });
}

function applyStrategy(strategy) {
  const active = document.querySelector('.strategy-card[aria-pressed="true"]');
  if (active && active.dataset.strategy !== strategy) active.click();
  if (!strategy) return;
  const target = document.querySelector(`.strategy-card[data-strategy="${strategy}"]`);
  if (target && target.getAttribute('aria-pressed') !== 'true') target.click();
}

function applyPreset(key) {
  const preset = presets[key];
  if (!preset || !workspaceReady()) {
    if (status) status.textContent = '企業データの読み込み後に利用できます。';
    return;
  }

  document.querySelector('#search').value = '';
  document.querySelector('#market').value = '';
  document.querySelector('#stage').value = preset.stage;
  document.querySelector('#sort').value = preset.sort;
  document.querySelector('#saved-only').checked = false;
  filters.dispatchEvent(new Event('input', { bubbles: true }));
  applyStrategy(preset.strategy);

  presetButtons.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.workspacePreset === key));
  });
  if (status) status.textContent = preset.message;
  directory?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

presetButtons.forEach(button => {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => applyPreset(button.dataset.workspacePreset));
});

const observer = new MutationObserver(updatePresetAvailability);
if (loading) observer.observe(loading, { attributes: true, attributeFilter: ['hidden'] });
if (errorPanel) observer.observe(errorPanel, { attributes: true, attributeFilter: ['hidden'] });
const strategyGrid = document.querySelector('#strategy-grid');
if (strategyGrid) observer.observe(strategyGrid, { childList: true });
updatePresetAvailability();
