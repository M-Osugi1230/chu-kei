const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

async function readData(file) {
  const response = await fetch('./data/' + file, { cache: 'no-cache' });
  if (!response.ok) throw new Error(file + ' を取得できませんでした。');
  return response.json();
}

function addCard(label, value, explanation = '') {
  return '<article class="platform-card"><span>' + esc(label) + '</span>' +
    '<div class="metric-value">' + esc(value) + '</div>' +
    (explanation ? '<p>' + esc(explanation) + '</p>' : '') +
    '</article>';
}

try {
  // Legacy quality release metadata and live GitHub listing universe are
  // different datasets. Never treat the 3,000-source bundle as 100% coverage.
  const [release, frontend, plan] = await Promise.all([
    readData('release-status.json'),
    readData('frontend/manifest.json'),
    readData('plan-detection-summary-v1.json'),
  ]);

  if (
    frontend.version !== 'frontend-data-manifest-v1' ||
    plan.version !== 'plan-detection-summary-v1' ||
    frontend.companyCount !== plan.companyCount ||
    frontend.universeCompanyCount !== plan.companyCount ||
    plan.resolvedCount + plan.pendingCount !== plan.companyCount
  ) {
    throw new Error('企業一覧と中計判定データの整合性が確認できません。');
  }

  const original = release.repository;
  const fetchedAt = String(plan.sourceFetchedAt ?? '').slice(0, 10) || '未記録';

  $('#release-updated').textContent =
    '旧品質台帳 ' + release.updatedAt + ' ／ JPX企業一覧取得 ' + fetchedAt;
  $('#sync-pill').textContent = release.sync.label;
  $('#sync-pill').className = 'status-pill ' + release.sync.status;

  $('#repo-stats').innerHTML = [
    ['現行検索対象', frontend.companyCount, 'JPXの最新国内3市場の対象企業。中計の確認済み社数ではありません。'],
    ['正式中計判定済み', plan.resolvedCount, '現行・過去中計等の判定が完了した企業。Deep Verification最終承認とは別です。'],
    ['中計未確認', plan.pendingCount, '公式中計のレビューが未完了。推測で分類しません。'],
    ['既存の構造化元データ', original.companies, '旧品質台帳の資料バンドル。現行検索対象と分けて管理。'],
    ['ソース確認（旧台帳）', original.sourceConfirmed],
    ['構造化済み（旧台帳）', original.structured],
    ['深掘り本番承認（旧台帳）', original.production],
    ['進捗登録企業', original.progressCompanies],
    ['実績接続企業', original.actualCompanies],
    ['過去中計企業', original.historyCompanies ?? 0],
    ['過去中計', String(original.historyPlans ?? 0) + '計画'],
    ['進捗変更', String(original.progressEvents ?? 0) + '件'],
    ['調査商品', String(original.commercialOffers ?? 0) + '件'],
    ['受付フォーム', String(original.forms?.length ?? 0) + '件'],
    ['品質負債（旧台帳）', original.qualityDebt],
  ].map(([label, value, explanation]) => addCard(label, value, explanation)).join('');

  $('#pending-sync').innerHTML = [
    'GitHub上の最新データと公開済みホスティングの一致は、別途公開サイト監査で証明する必要があります。',
    ...release.sync.pending,
  ].map(item => '<li>' + esc(item) + '</li>').join('');

  $('#release-raw').textContent = JSON.stringify({
    legacyQualityRelease: release,
    canonicalSearchAndPlanDetection: {
      companyCount: frontend.companyCount,
      sourceBundleCompanyCount: frontend.sourceBundleCompanyCount,
      universeOnlyCount: frontend.universeOnlyCount,
      sourceOnlyCount: frontend.sourceOnlyCount,
      frontendGeneratedAt: frontend.generatedAt,
      sourceFetchedAt: plan.sourceFetchedAt,
      resolvedCount: plan.resolvedCount,
      pendingCount: plan.pendingCount,
      planStatusCounts: plan.counts,
    },
  }, null, 2);
} catch (error) {
  $('#release-error').hidden = false;
  $('#release-error').textContent = error.message;
}
