# Chu-kei Quality Rebase Phase 3

Phase 3は、Phase 1 + Phase 2で一次レビューを完了した500社を、自動昇格させずにDeep Verificationへ接続するための工程です。

## 入口条件

- Phase 1一次レビュー: 50 / 50社
- Phase 2一次レビュー: 450 / 450社
- 一次レビュー合計: 500 / 500社
- 独立レビュー完了: 61社
- 明示Deep blockerあり: 1社
- blockerなし・別担当final review待ち: 60社
- Deep Verification最終承認: 0社

## Phase 3の原則

1. `finalDeepVerificationBlockers` が0件であることは「最終承認可能な候補」であり、承認そのものではありません。
2. 一次レビュー担当者は自分の一次レビューを最終承認しません。
3. 独立レビュー担当者も、自分が独立レビューした会社を同じ役割のまま最終承認しません。
4. final reviewerは、一次レビューと独立completionの証跡を読み、資料同一性・年度・単位・範囲・戦略・数値・資本政策・株主還元・公開状態を再確認します。
5. 公開サイトの表示とGitHub正本が一致するまで、公開済みであることを理由にDeep Verification承認を付与しません。
6. 自動事実補完、自動最終承認、自動本番昇格は禁止します。

## キュー生成

`node scripts/build_phase3_final_review_queue_v1.mjs`

このスクリプトは次の正本だけからキューを再構築します。

- `operations/quality-rebase/phase2/independent-review-status-v1.json`
- `operations/quality-rebase/phase2/deep-verification-status-v1.json`
- `operations/quality-rebase/phase2/independent-completions/*.json`

出力:

- `operations/quality-rebase/phase3/generated/final-review-queue-v1.json`

生成キューは、blockerなしの会社とblockerありの会社を分離し、会社コード単位で重複を禁止します。

## 検証

`node scripts/validate_phase3_final_review_queue_v1.mjs`

検証では以下を強制します。

- Phase 2一次レビュー450 / 450
- Phase 1込み500 / 500
- 独立completion件数と独立レビュー台帳件数の一致
- Deep Verification statusとキューのblocker件数一致
- blockerあり企業がready queueへ混入しない
- Deep Verification承認が自動的に増えていない
- final reviewerの役割分離要件を維持

## 公開同期

2026-08-24の再確認では、`chu-kei.com` は570社・詳しい情報100社・データ更新日2026-07-11の公開状態で、GitHub正本の3,000社およびQuality Rebase進捗に追随していません。

そのためPhase 3では、最終レビューと並行して公開同期を必須の品質課題として扱います。

421A ムービン・ストラテジック・キャリアは公開カード上で2028年12月期の売上100億円、営業利益46億円、営業利益率46.0%を確認済みです。ただし訂正後36ページ版の公式PDFリンクと詳細表示の公開後ブラウザ確認が未完了なので、`post_publication_link_and_render_check` は解除しません。

## 完了条件

Phase 3は「61社を一括承認する工程」ではありません。会社ごとに次を満たした時点でのみDeep Verificationへ昇格します。

- 一次レビュー完了
- 独立レビュー完了
- 明示blocker 0件
- 別役割final reviewerによる最終確認
- 必要な場合は公開後リンク・表示確認
- 監査記録の保存

以降は、61社のfinal reviewを進めつつ、残る独立図表レビューを追加の会社へ拡張します。
