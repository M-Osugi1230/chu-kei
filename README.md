# Chu-kei

日本上場企業の中期経営計画を、戦略の違いから探し、比較・理解・調査するためのポータルです。

- 公開サイト: https://chukei-insight.osugimurata.chatgpt.site/
- GitHub: `M-Osugi1230/chu-kei`

Chu-keiは投資助言・銘柄推奨を目的としません。未確認情報を推測で補完せず、公式一次資料、確認日、品質状態、レビュー判断を分離して管理します。

## Project baseline

プロジェクトの現状、差分、次の優先順位は次の基準文書を参照してください。

- [`docs/Chu-kei_project_current_and_ideal_v4.md`](docs/Chu-kei_project_current_and_ideal_v4.md)

主要件数やデータ階層が変わったときは、基準文書とREADMEを同じ変更単位で更新します。

## Source of truth

- 公開サイト: UX、画面構成、説明文、探索・比較体験の最新基準
- GitHub: 企業データ、出典、品質、変更履歴、レビュー判断、監査コードの正本

同期方針は [`docs/LIVE_SITE_ALIGNMENT.md`](docs/LIVE_SITE_ALIGNMENT.md) を参照してください。

## Current data release

2026-07-22時点の正本は次の状態です。

- 掲載企業: **2,500社**
- 公式資料確認・構造化済み: **2,000社**
- 本番品質（core）: **2,000社**
- 5つ星品質: **2,000社**
- 全品質要件充足: **2,000社**
- 詳細抽出済みβ: **0社**
- 承認待ち: **0社**
- 機械補修キュー: **0社**
- Coverageβ: **500社**
- 掲載対象内の公式資料確認率: **80.00%**
- 公開用進捗レコード: **353件**

2,000社は、公式一次資料、資料公表日、ページ番号または具体的な公式Web見出し、構造化分析、数値抽出、進捗評価、一次レビュー、独立再検証の要件を満たしています。

今回の拡張では、第13〜17回の連続調査で未調査500社を網羅し、過去17回分の候補レポートを現在の企業ステージと照合しました。現在もCoverageβである企業のうち457社が公式資料、企業同一性、信頼度、公表日、資料種別、複数ページ証跡、テーマ、構造化概要の条件を満たしました。その中から451社だけを提案SHA-256で固定し、一次レビューと独立再検証を付与して本番品質へ昇格しました。

完了監査は [`operations/source-research/SOURCE_COVERAGE_2000_COMPLETION_REPORT.md`](operations/source-research/SOURCE_COVERAGE_2000_COMPLETION_REPORT.md) を参照してください。

## Quality policy

- 公式PDFまたは会社公式IRページだけを一次資料として採用する
- 企業名または証券コード、資料名、公表日を確認する
- PDFは具体的なページ番号、Web資料は具体的な公式見出しを証跡として残す
- 未開示、未抽出、要確認、比較不能を区別する
- 自動事実補完、自動選定、自動承認、自動本番昇格を行わない
- 比較不能な目標に架空の進捗率を作らない
- 各社の一次レビューと独立再検証を記録する
- 件数を増やすために品質基準を緩めない

## Quality gates

主な自動監査は次のとおりです。

- Chu-kei v43 Quality Gate
- Apply Structured Source of Truth
- Data Contract Gate / Normalize Data Contract
- Quality Dashboard Gate / Quality Debt Budget
- Source Audit / Source Evidence Candidates
- Review Governance / Entity Identity Audit
- Production Repair Queue
- Release and Deployment Gate
- Search and Filter Contract
- Browser E2E
- Accessibility and Performance

## Research platform foundations

- 過去中計比較: `site/history.html` / `site/data/plan-history.json`
- 進捗変更イベント: `site/data/progress-events.json`
- 本番昇格ポリシー: `operations/promotion/policy-v1.json`
- 公開同期状況: `site/release.html` / `operations/site-sync/current.json`
- 端末内UX計測: `site/metrics.html`
- スポット調査受付: `site/reports.html`
- Pro・Team・Data/API先行登録: `site/pricing.html`
- プライバシー表示: `site/privacy.html`

## Commercial operations

- 商品定義正本: `operations/commercial/offers-v1.json`
- 公開商品データ: `site/data/offers.json`
- 商品Schema: `schemas/commercial-offers.schema.json`
- 受付項目Schema: `schemas/commercial-intake.schema.json`
- レポート雛形: `docs/SPOT_RESEARCH_REPORT_TEMPLATE_V1.md`
- 運用手順: `docs/SPOT_RESEARCH_OPERATIONS_V1.md`
- 顧客情報の取扱方針: `docs/COMMERCIAL_DATA_HANDLING_V1.md`

実際の顧客情報や個別納品物はGitHubへ保存しません。

## Local validation

```bash
npm run quality:local:quick
npm run quality:local
```

## Repository structure

- `site/` 公開用静的サイトとデータバンドル
- `schemas/` データ・運用Schema
- `scripts/` 品質監査、生成、補修支援
- `operations/` レビュー台帳、修正履歴、補修キュー、サイト同期記録
- `reports/` QA・監査記録
- `releases/` リリースマニフェストとチェックサム
- `docs/` 品質方針、運用方針、ロードマップ、プロジェクト基準文書

## Development priority after 2,000 production companies

1. Coverageβ500社を、公式IRページ、別資料、後発開示で再調査する
2. 2,000社の目標・実績接続を拡大し、定義差を安全に扱う
3. 前中計と現中計の比較、未達理由、戦略変更を主要企業から構造化する
4. 新しい中計、計画改定、決算更新の自動検知を強化する
5. GitHub main、公開サイト、品質ダッシュボード、リリース記録を完全同期する
6. 保存・比較・調査メモを継続利用型ワークスペースへ進化させる
7. スポット調査、Pro、Team、API・データライセンスの順に収益化検証を進める

次の拡張でも、公式資料が確認できない企業や品質要件を満たさない企業を、件数合わせで本番品質へ昇格させません。
