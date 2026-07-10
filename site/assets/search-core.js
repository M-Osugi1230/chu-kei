const SEARCH_FIELDS = ['code', 'name', 'market', 'industry', 'category', 'summary', 'document'];

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[‐‑‒–—―ー]/g, '-')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

export function tokenizeSearchQuery(query) {
  return normalizeSearchText(query)
    .split(' ')
    .map(token => token.trim())
    .filter(Boolean);
}

export function buildSearchDocument(company) {
  const values = SEARCH_FIELDS.map(field => company?.[field]);
  values.push(...(company?.themes || []));
  values.push(...(company?.highlights || []));
  return normalizeSearchText(values.filter(value => value != null).join(' '));
}

export function matchesSearchQuery(company, query) {
  const tokens = tokenizeSearchQuery(query);
  if (!tokens.length) return true;
  if (tokens.length === 1 && /^[0-9a-z]{4}$/.test(tokens[0])) {
    return normalizeSearchText(company.code) === tokens[0];
  }
  const document = company.__searchDocument || buildSearchDocument(company);
  return tokens.every(token => document.includes(token));
}

export function matchesCompanyFilters(company, filters = {}) {
  const { query = '', market = '', stage = '', strategy = '' } = filters;
  return matchesSearchQuery(company, query)
    && (!market || company.market === market)
    && (!stage || company.stage === stage)
    && (!strategy || Boolean(company.flags?.[strategy]));
}

export function searchRank(company, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;
  const normalizedCode = normalizeSearchText(company.code);
  const normalizedName = normalizeSearchText(company.name);
  if (normalizedCode === normalizedQuery || normalizedName === normalizedQuery) return 0;
  if (normalizedCode.startsWith(normalizedQuery) || normalizedName.startsWith(normalizedQuery)) return 1;
  if (normalizedName.includes(normalizedQuery)) return 2;
  return 3;
}

export function prepareCompaniesForSearch(companies) {
  return companies.map(company => ({ ...company, __searchDocument: buildSearchDocument(company) }));
}

export function filterAndRankCompanies(companies, filters = {}) {
  return companies
    .filter(company => matchesCompanyFilters(company, filters))
    .map((company, index) => ({ company, index, rank: searchRank(company, filters.query) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(item => item.company);
}
