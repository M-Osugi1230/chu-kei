# Chu-kei

日本上場企業の中期経営計画を、戦略の違いから探し、比較・理解・調査するためのポータルです。

- 公開サイト: https://chukei-insight.osugimurata.chatgpt.site/
- GitHub: `M-Osugi1230/chu-kei`

Chu-keiは投資助言・銘柄推奨を目的としません。未確認情報を推測で補完せず、出典、確認日、品質状態を分離して管理します。

## Project baseline

プロジェクトの現状、理想、差分、優先順位は、次の基準文書を参照してください。

- [`docs/Chu-kei_project_current_and_ideal_v1.md`](docs/Chu-kei_project_current_and_ideal_v1.md)

データ階層、主要件数、プロダクト方針または収益化方針が変わったときは、この基準文書も更新します。

## Source of truth

- 公開サイト: UX、画面構成、説明文、探索・比較体験の最新基準
- GitHub: 企業データ、出典、品質、変更履歴、レビュー判断、監査コードの正本

同期方針は [`docs/LIVE_SITE_ALIGNMENT.md`](docs/LIVE_SITE_ALIGNMENT.md) を参照してください。

## GitHub data release

- Version: v43
- Release: 570社 Quality Hardened Beta
- 掲載企業: 570社
- 中計ソース確認済み: 200社
- 主要論点構造化済み: 110社
- 本番: 30社
- 詳細抽出済みβ: 80社
- 一次確認β: 90社
- Coverageβ: 370社
- 進捗DB: 44社 / 149行
- 実績接続: 16社 / 54行
- 品質負債: 89項目
- 詳細βのページ証跡不足: 48社

570社すべてを同一品質として扱いません。企業探索、中計ソース確認、主要論点構造化、本番品質を明確に分離しています。

Issue #41 / PR #42では、品質基準を維持しながら主要論点構造化済み企業を110社から最大115社へ拡張する第4バッチを進めています。品質条件を満たす企業が5社に満たない場合も、件数を埋めるために基準を緩和しません。

## Research platform v2 foundations

企業探索から継続調査・公開透明性・収益化検証へ接続する基盤を整備しています。

- 過去中計比較: `site/history.html` / `site/data/plan-history.json`
- 進捗変更イベント: `site/data/progress-events.json`
- 本番昇格ポリシー: `operations/promotion/policy-v1.json`
- 公開同期状況: `site/release.html` / `operations/site-sync/current.json`
- 端末内UX計測: `site/metrics.html`
- スポット調査受付: `site/reports.html`
- Pro・Team・Data/API先行登録: `site/pricing.html`
- プライバシー表示: `site/privacy.html`

過去中計・進捗変更は、データ契約と表示基盤を先に用意し、公式一次資料とページ証跡を確認できた企業から追加します。本番昇格は自動化しません。

## Public site v15 alignment

2026-07-11時点で、別のプロダクト開発スレッドから次の公開状況が共有されています。

- 詳細抽出済みβ70社の公表日監査
- 監査充足: 59社
- 精査中: 11社
- 企業別変更履歴: 14件

この状態は [`operations/site-sync/chukei-insight-v15.json`](operations/site-sync/chukei-insight-v15.json) に記録しています。根拠台帳と変更履歴がGitHubへ同期されるまでは、自動的に本番データへ反映しません。

## Quality gates

主な自動監査は次のとおりです。

- v43 strict品質監査
- Data Contract Gate
- 品質スコアv2
- 出典登録・リンク監査
- レビュー・修正台帳監査
- 検索・複合フィルター契約
- 保存・比較・URL復元契約
- Research Platform v2契約
- Chromiumデスクトップ・390pxモバイルE2E
- WCAG A / AAアクセシビリティ
- 性能予算
- 企業同一性・表記揺れ監査
- Netlify公開物・リリースマニフェスト監査

## Repository structure

- `site/` 公開用静的サイトとデータバンドル
- `schemas/` データ・運用Schema
- `scripts/` 品質監査、生成、補修支援
- `operations/` レビュー台帳、修正履歴、補修キュー、サイト同期記録
- `reports/` QA・監査記録
- `releases/` リリースマニフェストとチェックサム
- `docs/` 品質方針、運用方針、ロードマップ、プロジェクト基準文書

## Development priority

1. Data Contract Gateを常時グリーンに保つ
2. 品質負債89項目と詳細βのページ証跡不足48社を継続削減する
3. 本番30社の不足項目を補修する
4. 詳細β80社をレビューし、100社本番品質化へ進む
5. 一次確認βから品質条件を満たす企業だけを構造化する
6. 進捗実績の接続と過去中計比較を強化する
7. 公開サイトとGitHub正本のリリース同期を一本化する
8. スポット調査レポート、Pro、Team、API・データライセンスの順に収益化する
