# Chu-kei

日本上場企業の中期経営計画を、戦略の違いから探し、比較・理解・調査するためのポータルです。

- 公開サイト: https://chu-kei.com/
- GitHub: `M-Osugi1230/chu-kei`

Chu-keiは投資助言・銘柄推奨を目的としません。未確認情報を推測で補完せず、公式一次資料、確認日、品質状態、レビュー判断を分離して管理します。

## Project baseline

プロジェクトの現状、差分、次の優先順位は次の基準文書を参照してください。

- [`docs/Chu-kei_project_current_and_ideal_v7.md`](docs/Chu-kei_project_current_and_ideal_v7.md)
- Phase 2進捗正本: [`operations/quality-rebase/phase2/effective-status-v1.json`](operations/quality-rebase/phase2/effective-status-v1.json)
- Phase 3進捗正本: [`operations/quality-rebase/phase3/status-v1.json`](operations/quality-rebase/phase3/status-v1.json)
- Phase 2会社コード単位監査: [`operations/quality-rebase/phase2/queue-coverage-audit-v1.json`](operations/quality-rebase/phase2/queue-coverage-audit-v1.json)

主要件数やデータ階層が変わったときは、基準文書、進捗正本、READMEを同じ変更単位で更新します。v6以前の旧5つ星件数は現行品質として使用しません。

## Source of truth

- 公開サイト: UX、画面構成、説明文、探索・比較体験の公開ビュー
- GitHub: 企業データ、出典、品質、変更履歴、レビュー判断、監査コードの正本

同期方針は [`docs/LIVE_SITE_ALIGNMENT.md`](docs/LIVE_SITE_ALIGNMENT.md) を参照してください。

## Current data release

2026-08-01のPhase 0再監査で、旧「3,000社すべて5つ星」を廃止し、掲載件数と深掘り確認済み件数を分離しました。2026-08-16以降は一次レビュー件数を会社コード単位のcanonical成果物で再集計し、割当履歴・再マップ行の二重計上を排除しました。2026-08-23に残存例外を含むcanonical一次レビューを完了し、Phase 2は450 / 450社、Phase 1込み500 / 500社へ到達しました。2026-08-24からPhase 3へ移行し、独立レビュー完了61社のうち明示blockerなし60社を別役割final reviewerへ回す工程と、公開サイト同期を並行して進めています。

- 掲載企業（GitHub正本）: **3,000社**
- Deep Verification最終承認（新基準）: **0社**
- 再監査母集団（非テンプレート型）: **315社**
- テンプレート型・深掘り前: **2,685社**
- Phase 1一次レビュー: **50 / 50社（100%）**
- Phase 2一次レビュー: **450 / 450社（100%）**
- Phase 1+2一次レビュー: **500 / 500社（100%）**
- Phase 2一次レビュー残り: **0社**
- 通常一次レビュー候補残り: **0社**
- 例外キュー候補残り: **0社**
- 独立レビュー完了: **61社**
- 明示Deep blockerあり: **1社（421A）**
- blockerなし・別担当final review待ち: **60社**
- 独立図表レビューpending: **396社**
- 資料名が決算短信で正式中計を再探索する企業: **610社**
- 広義の決算関連資料: **987社**
- 進捗レコード: **353件 / 100社**
- 目標と実績を接続済み: **258件 / 72社**
- 証跡候補レビュー対象: **116社**
- 既知404: **6件**
- Phase 2追加キュー: **450社（完了）**

2026-08-24の公開確認では、`chu-kei.com` は **570社・詳しい情報100社・データ更新日2026-07-11** の公開状態で、GitHub正本の3,000社およびQuality Rebase進捗にまだ追随していません。この差分はPhase 3の公開同期ブロッカーとして明示管理します。

旧5つ星は、項目が埋まっていること、旧レビュー記録、証跡文字列などの機械条件を評価しており、PDF全文の精読を証明していませんでした。新基準では、正式中計の確認、全文精読、戦略・数値・資本政策の構造化、項目別ページ証跡、年度・単位・連結範囲の検査、独立した再確認、別役割final reviewを満たした企業だけをDeep Verification最終承認へ進めます。

一次レビュー完了とDeep Verification最終承認は別状態です。自動抽出や候補選定、一次レビュー完了、blocker 0件だけで深掘り承認を付与しません。一次レビュー件数は会社コード単位のcanonicalレビュー成果物で数え、割当行数・再マップ行数・集計値だけでは完了扱いにしません。

## Quality policy

- 公式PDFまたは会社公式IRページだけを一次資料として採用する
- 企業名または証券コード、資料名、公表日を確認する
- PDFは具体的なページ番号、Web資料は具体的な公式見出しを証跡として残す
- 正式中計、Growth資料、単年度予想、長期ビジョン、旧中計を分離する
- 実績、予想、中計終端目標を分離する
- 未開示、未抽出、要確認、比較不能を区別する
- 自動事実補完、自動選定、自動承認、自動本番昇格を行わない
- 比較不能な目標に架空の進捗率を作らない
- 各社の一次レビュー、独立再検証、final reviewを役割分離して記録する
- 上場廃止企業は現行上場企業数へ含めず、公式理由付きアーカイブへ移す
- 件数を増やすために品質基準を緩めない

## Quality gates

- Chu-kei v43 Quality Gate
- Apply Structured Source of Truth
- Data Contract Gate / Normalize Data Contract
- Quality Dashboard Gate / Quality Debt Budget
- Source Audit / Source Evidence Candidates
- Review Governance / Entity Identity Audit
- Phase 2 Primary Review Wave Gate
- Independent Review Completion Gate
- Phase 3 Final Review Gate
- Phase 3 Production Verification
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
node scripts/build_phase3_final_review_queue_v1.mjs
node scripts/validate_phase3_final_review_queue_v1.mjs
```

## Repository structure

- `site/` 公開用静的サイトとデータバンドル
- `schemas/` データ・運用Schema
- `scripts/` 品質監査、生成、補修支援
- `operations/` レビュー台帳、修正履歴、補修キュー、サイト同期記録
- `reports/` QA・監査記録
- `releases/` リリースマニフェストとチェックサム
- `docs/` 品質方針、運用方針、ロードマップ、プロジェクト基準文書

## Development priority after Phase 2 completion

1. Phase 3 final-review queueを正本から再生成し、blockerなし60社を別役割final reviewerへ回す
2. 421Aの `post_publication_link_and_render_check` を、訂正後36ページ版の公式PDFリンクと実公開詳細表示を確認できた場合のみ解除する
3. GitHub正本3,000社と `chu-kei.com` の公開570社状態を解消し、品質表示・資料区分・出典・確認日を同期する
4. 公開後に検索・企業詳細・公式資料リンク・年度・単位・モバイル表示をproduction verificationで再監査する
5. 独立図表レビューpending 396社を古いWaveから追加処理し、final-review候補を61社から拡張する
6. 610社の決算短信起点データから正式な中計資料を再探索する
7. 116社の証跡候補と6件の404を解消する
8. 353件の進捗データを企業詳細へ同期し、72社・258件の実績接続を維持・拡大する
9. 新中計・改定・決算更新の日次検知と週次公開を定常化する
10. 500社工程で得た品質指標を反映し、基準を緩めず1,000社の高品質構造化へ段階拡張する
