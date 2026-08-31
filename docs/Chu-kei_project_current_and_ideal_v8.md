# Chu-kei プロジェクト 現状・理想・差分整理 v8

- 更新日: 2026-08-24
- 対象リポジトリ: `M-Osugi1230/chu-kei`
- 公開サイト: `https://chu-kei.com/`
- 前版: [`Chu-kei_project_current_and_ideal_v7.md`](Chu-kei_project_current_and_ideal_v7.md)
- Phase 2進捗正本: [`operations/quality-rebase/phase2/effective-status-v1.json`](../operations/quality-rebase/phase2/effective-status-v1.json)
- Phase 3進捗正本: [`operations/quality-rebase/phase3/status-v1.json`](../operations/quality-rebase/phase3/status-v1.json)
- 公開同期台帳: [`operations/site-sync/current.json`](../operations/site-sync/current.json)

> v8はPhase 2一次レビュー450 / 450社完了後の基準文書である。一次レビュー完了をDeep Verification最終承認と同一視せず、独立レビュー、別役割final review、必要な公開後確認を分離する。

## 1. 現在地

| 項目 | 現在値 |
|---|---:|
| 掲載企業（GitHub正本） | 3,000社 |
| Phase 1 一次レビュー完了 | 50 / 50社 |
| Phase 2 一次レビュー完了 | 450 / 450社 |
| Phase 1+2 一次レビュー完了 | 500 / 500社 |
| Phase 2 一次レビュー残り | 0社 |
| 独立レビュー完了 | 61社 |
| 明示Deep blockerあり | 1社 |
| blockerなし・別担当final review待ち | 60社 |
| 独立図表レビューpending | 396社 |
| Deep Verification最終承認 | 0社 |
| 正式中計再探索対象（決算短信起点） | 610社 |
| 証跡候補レビュー対象 | 116社 |
| 既知404 | 6件 |
| 進捗レコード | 353件 / 100社 |
| 目標と実績を接続済み | 258件 / 72社 |

## 2. Phase 2完了

2026-08-23にPhase 2残存例外まで会社コード単位で再照合し、canonical一次レビュー成果物を450 / 450社へ到達させた。Phase 1 50社と合わせ、500 / 500社の一次レビューが完了した。

最終6社では特に次を確認した。

- 285A キオクシアホールディングス: 自動回収バイナリの取り違えを除外し、公式Investor Day 2026へ修正
- 3692 FFRIセキュリティ: Growth資料内に2027年3月期～2029年3月期の正式中期経営計画を確認
- 4598 Delta-Fly Pharma: パイプライン戦略と単年度予想を正式中計と混同しない
- 4891 ティムス: 研究開発工程と会社全体の中期財務計画を分離
- 6323 ローツェ: 自動回収バイナリの取り違えを除外し、現行公式決算説明資料へ修正
- 6558 クックビズ: 2028年頃までの中期ターゲットを保持しつつ、正式名称を持つ中期経営計画とは区別

Phase 2一次レビュー完了後も自動Deep Verification承認は0のまま維持する。

## 3. Phase 3の目的

Phase 3は、一次レビュー済み企業を最終品質へ安全に進める工程である。

現在、独立レビュー完了61社のうち:

- 60社: 明示blockerなし。別役割final reviewerへ送る。
- 1社: 421A ムービン・ストラテジック・キャリア。`post_publication_link_and_render_check` が残る。

blockerが0であることは承認ではない。final reviewerは一次レビュー・独立completion・公式資料・必要な公開状態を再確認し、別記録として最終判断を残す。

## 4. Phase 3 final-review queue

`node scripts/build_phase3_final_review_queue_v1.mjs`

独立completion 61社を正本から再走査し、会社コード単位で次へ分離する。

- `pending_separate_final_reviewer`
- `blocked_before_final_review`

`node scripts/validate_phase3_final_review_queue_v1.mjs` は、件数、重複、blocker、役割分離、自動承認禁止を検証する。

GitHub Actions `Phase 3 Final Review Gate` でキューを毎回再生成し、監査artifactとして保存する。

## 5. 421Aの残存blocker

421Aは訂正後36ページ版公式PDFを独立レビューでcanonical sourceへ確定済みである。

2026-08-24の公開確認では、`chu-kei.com` 上に企業カードと次の数値が表示されることを確認した。

- 2028年12月期 売上100億円
- 営業利益46億円
- 営業利益率46.0%

ただし公開詳細画面から訂正後36ページ版へ到達できる公式リンクと詳細レンダリングの実ブラウザ確認は未完了である。そのためblockerは解除しない。

## 6. 公開同期の新しい最大ボトルネック

2026-08-24の実公開確認では、`chu-kei.com` は次の状態だった。

- 570社収録
- 詳しい情報100社
- データ更新日 2026-07-11

GitHub正本は3,000社で、Quality Rebaseの一次レビューは500社まで進んでいる。したがって現在の最大のプロダクト差分は、品質作業そのものだけではなく **GitHub正本と公開サイトのリリース差** である。

今後は `production_behind_repository_quality_state` を明示し、公開570社を正本へ戻すのではなく、GitHub側の品質済み状態を段階的に公開へ反映する。

## 7. Production Verification

Phase 3では専用Playwright検証を追加する。

- 本番収録件数を観測
- 本番詳細件数を観測
- 421Aを検索
- 主要目標を確認
- 企業詳細を開く
- 訂正後公式PDFリンクを確認
- PDFのHTTP到達性・content-typeを確認

定期観測は自動実行してよいが、観測成功だけでDeep Verification承認や本番昇格を自動化しない。

## 8. 次のマイルストーン

### Milestone A — Phase 3 queueのCI固定

60社ready / 1社blockedを正本から再現し、CIで件数とガバナンスを固定する。

### Milestone B — 421A公開後blocker解消

訂正後公式PDFリンクと詳細レンダリングを本番ブラウザで確認できた場合のみblockerを0へ更新する。

### Milestone C — GitHub / production同期

3,000社のGitHub正本と現在570社の公開状態の差を解消し、品質状態・資料区分・出典・確認日を公開へ反映する。

### Milestone D — 60社final review

別役割final reviewerで会社ごとに最終確認を行う。承認記録がない企業を一括Deep Verifiedにしない。

### Milestone E — 独立レビュー拡張

独立図表レビューpending 396社を古いWaveから処理し、61社に留まるfinal-review候補を増やす。

### Milestone F — 品質負債並行解消

正式中計再探索610社、証跡候補116社、既知404 6件を継続処理する。

### Milestone G — 1,000社高品質化

500社工程で得た誤資料率・資料境界・レビュー工数・公開同期知見を用い、品質基準を緩めず段階拡張する。

## 9. 変えない原則

- Chu-keiは投資助言・銘柄推奨を目的としない。
- 公式一次資料を正本とする。
- 不明情報を推測で埋めない。
- 正式中計、Growth資料、単年度予想、長期ビジョンを分離する。
- 実績、予想、計画を分離する。
- 一次レビュー、独立レビュー、final reviewを役割分離する。
- 自動事実補完、自動Deep Verification承認、自動本番昇格を行わない。
- 件数を増やすために品質基準を緩めない。
