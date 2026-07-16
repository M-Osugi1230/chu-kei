const METRIC_LABELS = {
  revenue: '売上高',
  operatingProfit: '営業利益',
  ordinaryProfit: '経常利益',
  netProfit: '当期利益',
  margin: '営業利益率',
  operatingMargin: '営業利益率',
  adjustedOperatingMargin: '調整後営業利益率',
  nonGaapOperatingMargin: 'Non-GAAP営業利益率',
  ebitdaMargin: 'EBITDAマージン',
  roe: 'ROE',
  ROE: 'ROE',
  adjustedRoe: '調整後ROE',
  roic: 'ROIC',
  ROIC: 'ROIC',
  ROA: 'ROA',
  dividendPayoutRatio: '配当性向',
  totalReturnRatio: '総還元性向',
  totalReturnRatioRolling3Years: '3年ローリング総還元性向',
  overseasRevenueRatio: '海外売上高比率',
  revenueCagr: '売上高CAGR',
  operatingProfitCagr: '営業利益CAGR',
  organicGrowthCagr: 'オーガニック成長率',
  deRatio: 'D/Eレシオ',
  debtToEbitda: 'Debt / EBITDA',
  investmentTotal: '投資総額',
  underlyingBusinessProfit: '基礎営業利益',
  growthInvestmentCapacity: '成長投資余力',
};

export function progressMetricLabel(metric) {
  return METRIC_LABELS[metric] ?? String(metric ?? '指標');
}

export function buildProgressIndex(rows = []) {
  const index = new Map();
  for (const row of rows) {
    const code = String(row.code ?? '');
    if (!index.has(code)) index.set(code, []);
    index.get(code).push(row);
  }
  for (const values of index.values()) {
    values.sort((a, b) => Number(b.actualValue != null) - Number(a.actualValue != null)
      || String(a.fiscalYear ?? '').localeCompare(String(b.fiscalYear ?? ''), 'ja')
      || progressMetricLabel(a.metric).localeCompare(progressMetricLabel(b.metric), 'ja'));
  }
  return index;
}

export function progressForCode(index, code) {
  return index?.get(String(code)) ?? [];
}

export function progressSummary(rows = []) {
  if (!rows.length) return '未接続';
  const actual = rows.filter(row => row.actualValue != null).length;
  const latest = rows.map(row => row.updatedAt || row.lastVerifiedDate).filter(Boolean).sort().at(-1);
  return `${rows.length}目標${actual ? `・実績${actual}件` : '・実績未接続'}${latest ? `・更新${latest}` : ''}`;
}

export function formatProgressNumber(value) {
  if (value == null || value === '') return '未接続';
  if (typeof value !== 'number') return String(value);
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value);
}

export function formatProgressValue(value, unit) {
  const formatted = formatProgressNumber(value);
  if (formatted === '未接続') return formatted;
  return `${formatted}${unit ?? ''}`;
}

export function progressRateText(row) {
  if (row.progressRate == null) return '実績未接続';
  return `単純進捗率 ${formatProgressNumber(row.progressRate)}%`;
}

export function latestActualProgress(rows = []) {
  const actualRows = rows.filter(row => row.actualValue != null);
  if (!actualRows.length) return null;
  return [...actualRows].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
}
