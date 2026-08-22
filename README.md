# Chu-kei

日本上場企業の中期経営計画を、戦略の違いから探し、比較・理解・調査するためのポータルです。

- 公開サイト: https://chu-kei.com/
- GitHub: `M-Osugi1230/chu-kei`

Chu-keiは投資助言・銘柄推奨を目的としません。未確認情報を推測で補完せず、公式一次資料、確認日、品質状態、レビュー判断を分離して管理します。

## Project baseline

プロジェクトの現状、差分、次の優先順位は次の基準文書を参照してください。

- [`docs/Chu-kei_project_current_and_ideal_v7.md`](docs/Chu-kei_project_current_and_ideal_v7.md)
- Phase 2進捗正本: [`operations/quality-rebase/phase2/effective-status-v1.json`](operations/quality-rebase/phase2/effective-status-v1.json)
- Phase 2会社コード単位監査: [`operations/quality-rebase/phase2/queue-coverage-audit-v1.json`](operations/quality-rebase/phase2/queue-coverage-audit-v1.json)

主要件数やデータ階層が変わったときは、基準文書、Phase 2進捗正本、READMEを同じ変更単位で更新します。v6以前の旧5つ星件数は現行品質として使用しません。

## Source of truth

- 公開サイト: UX、画面構成、説明文、探索・比較体験の公開ビュー
- GitHub: 企業データ、出典、品質、変更履歴、レビュー判断、監査コードの正本

同期方針は [`docs/LIVE_SITE_ALIGNMENT.md`](docs/LIVE_SITE_ALIGNMENT.md) を参照してください。

## Current data release

2026-08-01のPhase 0再監査で、旧「3,000社すべて5つ星」を廃止し、掲載件数と深掘り確認済み件数を分離しました。2026-08-16の会社コード単位再突合では、従来のPhase 2完了370社に再マップ・割当履歴由来の集計差が含まれていたため、canonical一次レビュー成果物が存在する360社を正本へ補正しました。

- 掲載企業: **3,000社**
- Deep Verification最終承認（新基準）: **0社**
- 再監査母集団（非テンプレート型）: **315社**
- テンプレート型・深掘り前: **2,685社**
- Phase 1一次レビュー: **50 / 50社**
- Phase 2一次レビュー: **360 / 450社（80.0%）**
- Phase 1+2一次レビュー: **410 / 500社（82.0%）**
- Phase 2一次レビュー残り: **90社**
- 通常一次レビュー候補残り: **4社**
- 例外キュー候補残り: **86社**
- 独立レビュー完了: **61社**
- 独立レビュー通常pending: **1社**
- 独立図表レビューpending: **306社**
- 資料名が決算短信で正式中計を再探索する企業: **610社**
- 広義の決算関連資料: **987社**
- 進捗レコード: **353件 / 100社**
- 目標と実績を接続済み: **258件 / 72社**
- 証跡候補レビュー対象: **116社**
- 既知404: **6件**
- Phase 2追加キュー: **450社（50社×9バッチ）**

旧5つ星は、項目が埋まっていること、旧レビュー記録、証跡文字列などの機械条件を評価しており、PDF全文の精読を証明していませんでした。新基準では、正式中計の確認、全文精読、戦略・数値・資本政策の構造化、項目別ページ証跡、年度・単位・連結範囲の検査、独立した再確認をすべて満たした企業だけをDeep Verification最終承認へ進めます。

一次レビュー完了とDeep Verification最終承認は別状態です。自動抽出や候補選定、一次レビュー完了だけで深掘り承認を付与しません。一次レビュー件数は会社コード単位のcanonicalレビュー成果物で数え、割当行数・再マップ行数・集計値だけでは完了扱いにしません。

## Quality policy

- 公式PDFまたは会社公式IRページだけを一次資料として採用する
- 企業名または証券コード、資料名、公表日を確認する
- PDFは具体的なページ番号、Web資料は具体的な公式見出しを証跡として残す
- 正式中計、Growth資料、単年度予想、長期ビジョン、旧中計を分離する
- 実績、予想、中計終端目標を分離する
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

## Development priority after canonical-count reconciliation

1. 通常一次レビュー候補4社を処理し、例外キュー86社は資料同定・誤資料修復・source recoveryを先に行う
2. Phase 2残り90社を会社コード単位のcanonical成果物で完了し、Phase 1込み一次レビュー500 / 500社へ到達する
3. 独立図表レビューpending 306社を古いWaveから並行処理する
4. 独立レビュー完了企業からDeep Verification最終承認工程へ進める
5. 610社の決算短信起点データから正式な中計資料を再探索する
6. 116社の証跡候補と6件の404を解消する
7. 353件の進捗データを企業詳細へ同期し、72社・258件の実績接続を維持・拡大する
8. GitHub正本と `chu-kei.com` の品質表示・企業データを完全同期する
9. 新中計・改定・決算更新の日次検知と週次公開を定常化する
10. 500社工程で得た品質指標を反映し、基準を緩めず1,000社へ段階拡張する
