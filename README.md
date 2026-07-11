# Chu-kei

日本上場企業の中期経営計画を、戦略の違いから探し、比較・理解・調査するためのポータルです。

- 公開サイト: https://chukei-insight.osugimurata.chatgpt.site/
- GitHub: `M-Osugi1230/chu-kei`

Chu-keiは投資助言・銘柄推奨を目的としません。未確認情報を推測で補完せず、出典、確認日、品質状態を分離して管理します。

## Source of truth

- 公開サイト: UX、画面構成、説明文、探索・比較体験の最新基準
- GitHub: 企業データ、出典、品質、変更履歴、レビュー判断、監査コードの正本

同期方針は [`docs/LIVE_SITE_ALIGNMENT.md`](docs/LIVE_SITE_ALIGNMENT.md) を参照してください。

## GitHub data release

- Version: v43
- Release: 570社 Quality Hardened Beta
- 掲載企業: 570社
- 本番: 30社
- 詳細抽出済みβ: 70社
- 一次確認β: 100社
- Coverageβ: 370社
- 進捗DB: 44社 / 149行
- 実績接続: 16社

570社すべてを同一品質として扱いません。企業探索、中計ソース確認、主要論点構造化、本番品質を明確に分離しています。

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
- `docs/` 品質方針、運用方針、ロードマップ

## Development priority

1. Data Contract Gateを常時グリーンに保つ
2. 公開サイトv15の59社監査根拠と14件の変更履歴を同期する
3. 本番30社の不足項目を補修する
4. 詳細β70社をレビューし、100社本番品質化へ進む
5. 過去中計比較と進捗追跡を強化する
6. スポット調査レポート、Pro、Team、API・データライセンスの順に収益化する
