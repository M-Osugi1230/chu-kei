# Chu-kei 公開サイトとGitHubの同期方針

## 対象

- 公開サイト: `https://chu-kei.com/`
- 表示名: `Chu-kei`
- GitHub: `M-Osugi1230/chu-kei`
- 公開同期台帳: `operations/site-sync/current.json`
- Phase 3状態: `operations/quality-rebase/phase3/status-v1.json`

## 正本の役割

### 公開サイト

公開サイトは、ユーザー体験、画面構成、説明文、探索導線、比較体験についての実公開ビューとする。

### GitHub

GitHubは、企業データ、出典、品質状態、監査結果、変更履歴、レビュー判断、昇格判断、再現可能な検証コードについての正本とする。

公開サイト上の表示変更がデータの意味を変える場合、GitHubのSchema、監査、変更台帳を先に更新する。公開サイトだけで企業データを修正しない。

## 現在の差分

2026-08-24に `https://chu-kei.com/` を再確認した時点では、公開サイトは次の状態だった。

- 収録企業: 570社
- 詳しい情報あり: 100社
- データ更新日表示: 2026-07-11
- 421A ムービン・ストラテジック・キャリアの企業カード: 表示あり
- 421Aの表示目標: 2028年12月期 売上100億円、営業利益46億円、営業利益率46.0%

一方、GitHub正本は次の状態に進んでいる。

- 掲載企業: 3,000社
- Phase 1一次レビュー: 50 / 50社
- Phase 2一次レビュー: 450 / 450社
- 一次レビュー合計: 500 / 500社
- 独立レビュー完了: 61社
- blockerなし・別担当final review待ち: 60社
- 明示Deep blockerあり: 1社
- Deep Verification最終承認: 0社

したがって、現在は `production_behind_repository_quality_state` と扱う。公開570社という状態をGitHub正本へ逆輸入せず、GitHubの現行品質状態を安全に公開側へ昇格する。

## 421Aの扱い

421Aは訂正後36ページ版を独立レビューでcanonical sourceとして確定している。ただし2026-08-24時点では、公開サイトの企業カードと主要目標までは確認できたものの、公開詳細画面から訂正後公式PDFへ到達できることと、その詳細レンダリングを実ブラウザで確認できていない。

そのため `post_publication_link_and_render_check` は解除しない。

Phase 3 Production Verificationは、次を満たした場合のみ421Aの公開後blockerを解消可能とする。

1. 421Aを公開検索で特定できる。
2. 2028年12月期 売上100億円・営業利益46億円が表示される。
3. 企業詳細を開ける。
4. 訂正後36ページ版の公式PDFリンクが表示される。
5. 公式PDFリンクがHTTP成功しPDFとして取得できる。
6. 表示崩れ・重大なブラウザエラーがない。

## 同期単位

公開サイトの各リリースについて、`operations/site-sync/`に次を記録する。

- リリース識別子
- 公開URL
- 確認日時
- GitHub基準SHA
- 主要機能
- 掲載企業数
- 品質状態別件数
- GitHubへ取り込み済みの項目
- 未同期項目
- 根拠となる監査・変更履歴ファイル
- production verification結果

## 同期ゲート

GitHub正本を公開サイトへ昇格し、同期済みと宣言するには次を満たす。

1. 公式一次資料の出典がある。
2. 資料公表日と確認日が分離されている。
3. 未確認・未開示・未抽出を推測で補完していない。
4. 修正履歴またはレビュー判断が記録されている。
5. Data Contract Gateが成功する。
6. strict品質監査が成功する。
7. Search and Filter Contractが成功する。
8. Browser E2Eが成功する。
9. Accessibility and Performanceが成功する。
10. Release and Deployment Gateが成功する。
11. Phase 3 Production Verificationで公開件数・企業詳細・公式資料リンクを実ブラウザ確認する。
12. `operations/site-sync/current.json` を実公開状態で更新する。

## 自動化ポリシー

- 自動事実補完を行わない。
- 自動Deep Verification承認を行わない。
- 自動本番昇格を行わない。
- Production Verificationの定期観測は許可するが、観測成功だけで品質承認を付与しない。
- 公開サイトとGitHubの差分がある場合は、差分を隠さず同期台帳に残す。

## 収益化との関係

公開サイトは無料の比較・理解体験を磨き、GitHubの品質済みデータを将来のスポット調査レポート、Pro、Team、API・データライセンスへ接続する。

収益化のために品質状態や出典制約を非表示にしない。Chu-keiは投資助言または銘柄推奨を目的としない。
