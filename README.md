# Chu-kei

日本上場企業の中期経営計画を、戦略の違いから探し、比較・理解・調査するためのポータルです。

- 公開サイト: https://chukei-insight.osugimurata.chatgpt.site/
- GitHub: `M-Osugi1230/chu-kei`

Chu-keiは投資助言・銘柄推奨を目的としません。未確認情報を推測で補完せず、公式一次資料、確認日、品質状態、レビュー判断を分離して管理します。

## Project baseline

プロジェクトの現状、差分、次の優先順位は次の基準文書を参照してください。

- [`docs/Chu-kei_project_current_and_ideal_v6.md`](docs/Chu-kei_project_current_and_ideal_v6.md)

主要件数やデータ階層が変わったときは、基準文書とREADMEを同じ変更単位で更新します。

## Source of truth

- 公開サイト: UX、画面構成、説明文、探索・比較体験の最新基準
- GitHub: 企業データ、出典、品質、変更履歴、レビュー判断、監査コードの正本

同期方針は [`docs/LIVE_SITE_ALIGNMENT.md`](docs/LIVE_SITE_ALIGNMENT.md) を参照してください。

## Current data release

2026-08-01のPhase 0再監査で、旧「3,000社すべて5つ星」を廃止し、掲載件数と深掘り確認済み件数を分離しました。

- 掲載企業: **3,000社**
- 深掘り確認済み（新基準）: **0社**
- 再監査母集団（非テンプレート型）: **315社**
- うちPhase 1の厳格候補: **50社**
- テンプレート型・深掘り前: **2,685社**
- 資料名が決算短信で正式中計を再探索する企業: **610社**
- 広義の決算関連資料: **987社**
- 進捗レコード: **353件 / 100社**
- 目標と実績を接続済み: **258件 / 72社**
- 証跡候補レビュー対象: **116社**
- 既知404: **6件**
- Phase 2追加キュー: **450社（50社×9バッチ）**

旧5つ星は、項目が埋まっていること、旧レビュー記録、証跡文字列などの機械条件を評価しており、PDF全文の精読を証明していませんでした。新基準では、正式中計の確認、全文精読、戦略・数値・資本政策の構造化、項目別ページ証跡、年度・単位・連結範囲の検査、独立した再確認をすべて満たした企業だけを「深掘り確認済み」とします。

Phase 1の50社とPhase 2の追加450社は処理キューであり、承認済み件数ではありません。自動抽出や候補選定によって深掘り承認を付与しません。

## Quality policy

- 公式PDFまたは会社公式IRページだけを一次資料として採用する
- 企業名または証券コード、資料名、公表日を確認する
- PDFは具体的なページ番号、Web資料は具体的な公式見出しを証跡として残す
- 未開示、未抽出、要確認、比較不能を区別する
- 自動事実補完、自動選定、自動承認、自動本番昇格を行わない
- 比較不能な目標に架空の進捗率を作らない
- 各社の一次レビューと独立再検証を記録する
- 上場廃止企業は現行上場企業数へ含めず、公式理由付きアーカイブへ移す
- 件数を増やすために品質基準を緩めない

## Quality gates

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

## Development priority after Phase 0 quality rebase

1. Phase 1の50社を新工程で全文精読し、抽出精度・所要工数・差戻し率を測定する
2. Phase 2で深掘り確認済み500社まで50社単位で拡張する
3. 610社の決算短信起点データから正式な中計資料を再探索する
4. 116社の証跡候補と6件の404を解消する
5. 353件の進捗データを企業詳細へ同期し、72社・258件の実績接続を維持する
6. 新中計・改定・決算更新の日次検知と週次公開を定常化する
7. 品質基準や承認手続きを件数のために緩めず、1,000社へ段階拡張する
