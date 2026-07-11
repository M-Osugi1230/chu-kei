export const SORT_OPTIONS = new Set(['relevance', 'quality', 'verified', 'code']);

function allowed(value, values) {
  return values?.has(value) ? value : '';
}

function validCode(value, validCodes) {
  return /^[0-9A-Z]{4}$/.test(value) && (!validCodes || validCodes.has(value));
}

export function parseWorkspaceUrl(href, options = {}) {
  const url = new URL(href, 'https://chukei.local/');
  const validMarkets = options.validMarkets ?? new Set(['Prime', 'Standard', 'Growth']);
  const validStages = options.validStages ?? new Set(['core', 'detailed_extracted', 'source_indexed', 'jpx_indexed']);
  const validStrategies = options.validStrategies ?? new Set();
  const validCodes = options.validCodes;
  const compare = [...new Set((url.searchParams.get('compare') ?? '')
    .split(',')
    .map(value => value.trim().toUpperCase())
    .filter(value => validCode(value, validCodes)))]
    .slice(0, 4);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const company = String(hashParams.get('company') ?? '').toUpperCase();

  return {
    query: url.searchParams.get('q') ?? '',
    market: allowed(url.searchParams.get('market') ?? '', validMarkets),
    stage: allowed(url.searchParams.get('stage') ?? '', validStages),
    strategy: allowed(url.searchParams.get('strategy') ?? '', validStrategies),
    sort: SORT_OPTIONS.has(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'relevance',
    savedOnly: url.searchParams.get('saved') === '1',
    compare,
    company: validCode(company, validCodes) ? company : '',
  };
}

export function buildWorkspaceUrl(href, state = {}) {
  const url = new URL(href, 'https://chukei.local/');
  const setOrDelete = (key, value, defaultValue = '') => {
    if (value && value !== defaultValue) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  };

  setOrDelete('q', String(state.query ?? '').trim());
  setOrDelete('market', state.market);
  setOrDelete('stage', state.stage);
  setOrDelete('strategy', state.strategy);
  setOrDelete('sort', SORT_OPTIONS.has(state.sort) ? state.sort : 'relevance', 'relevance');
  if (state.savedOnly) url.searchParams.set('saved', '1');
  else url.searchParams.delete('saved');

  const compare = [...new Set([...(state.compare ?? [])])]
    .map(value => String(value).toUpperCase())
    .filter(value => /^[0-9A-Z]{4}$/.test(value))
    .slice(0, 4);
  if (compare.length) url.searchParams.set('compare', compare.join(','));
  else url.searchParams.delete('compare');

  if (state.company && /^[0-9A-Z]{4}$/.test(String(state.company).toUpperCase())) {
    url.hash = `company=${encodeURIComponent(String(state.company).toUpperCase())}`;
  } else {
    url.hash = '';
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
