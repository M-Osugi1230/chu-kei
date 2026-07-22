# Chu-kei

日本上場企業の中期経営計画を、戦略の違いから探し、比較・理解・調査するためのポータルです。

- 公開サイト: https://chukei-insight.osugimurata.chatgpt.site/
- GitHub: `M-Osugi1230/chu-kei`

Chu-keiは投資助言・銘柄推奨を目的としません。未確認情報を推測で補完せず、公式一次資料、確認日、品質状態、レビュー判断を分離して管理します。

## Project baseline

プロジェクトの現状、差分、次の優先順位は次の基準文書を参照してください。

- [`docs/Chu-kei_project_current_and_ideal_v3.md`](docs/Chu-kei_project_current_and_ideal_v3.md)

主要件数やデータ階層が変わったときは、基準文書とREADMEを同じ変更単位で更新します。

## Source of truth

- 公開サイト: UX、画面構成、説明文、探索・比較体験の最新基準
- GitHub: 企業データ、出典、品質、変更履歴、レビュー判断、監査コードの正本

同期方針は [`docs/LIVE_SITE_ALIGNMENT.md`](docs/LIVE_SITE_ALIGNMENT.md) を参照してください。

## Current data release

2026-07-22時点の正本は次の状態です。

- 掲載企業: **2,500社**
- 公式資料確認・構造化済み: **1,549社**
- 本番品質（core）: **1,549社**
- 5つ星品質: **1,549社**
- 全品質要件充足: **1,549社**
- 詳細抽出済みβ: **0社**
- 承認待ち: **0社**
- 機械補修キュー: **0社**
- Coverageβ: **951社**
- 掲載対象内の公式資料確認率: **61.96%**
- 公開用進捗レコード: **353件**

1,549社は、公式一次資料、資料公表日、ページ番号または具体的な公式Web見出し、構造化分析、数値抽出、進捗評価、一次レビュー、独立再検証の要件を満たしています。

今回の拡張では、JPX公式上場銘柄一覧から600社をCoverageβとして追加し、その新規候補から100社を調査しました。100社のうち78社が自動的な硬い品質条件を満たし、さらに直近の正式な中計・経営戦略と複数ページ証跡が揃う49社だけを提案ハッシュ固定・二段階承認で本番品質へ昇格しました。残る51社は件数合わせで採用していません。

完了監査は [`operations/source-research/SOURCE_COVERAGE_1549_COMPLETION_REPORT.md`](operations/source-research/SOURCE_COVERAGE_1549_COMPLETION_REPORT.md) を参照してください。

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

## Development priority after 1,549 production companies

1. 新規未調査500社を100社単位で調査し、品質条件を満たす企業だけを追加する
2. 今回保留した29社と失敗22社を、公式IRページや別資料で個別再調査する
3. 1,549社の進捗目標・実績接続を拡大する
4. 前中計と現中計の比較、未達理由、戦略変更を主要企業から構造化する
5. GitHub main、公開サイト、README、品質ダッシュボード、リリース記録を自動同期する
6. 保存・比較・調査メモを継続利用型ワークスペースへ進化させる
7. スポット調査、Pro、Team、API・データライセンスの順に収益化検証を進める

次の拡張でも、公式資料が確認できない企業や品質要件を満たさない企業を、件数合わせで本番品質へ昇格させません。
