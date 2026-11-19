# 開示検知（detection v1）

新しい中期経営計画の公表・改定・一次資料の変化を自動で検知し、確認待ちキュー（inbox）に集める仕組みです。収益化方針（Notion 共有資料「⑤ 収益化方針」）で「共通ボトルネック」とした検知の実装であり、蓄積される検知履歴と一次資料スナップショット自体が資産になります。

## 絶対条件

- 検知ジョブは **registry や公開データ（site/）を一切変更しません**。書き込むのは `operations/detection/` 配下の機械管理ファイルだけです。
- inbox の項目は「未確認の候補」です。一次資料での検証と承認を経て初めて、既存の override / ビルド手順で公開データに反映されます（lastVerifiedDate の扱いなど既存ルールはそのまま）。
- 検知できなかったことを「変化なし」と記録しません。取得失敗は失敗として記録します。

## 構成

### A. 一次資料ウォッチ（watch_sources_v1.mjs）

- 対象：registry で解決済み（current / expired）の 500 社が持つ `review.sourceUrl`（全件ユニーク、うち大半は TDnet の PDF）。
- 週1回（月曜 07:00 JST）、各 URL の内容を取得して SHA-256 を `source-snapshot-v1.json` の前回値と比較します。
- 変化があれば inbox に `document_changed`、HTTP 404/410 で消えていれば `document_gone`、取得エラーが 3 回続けば `fetch_error` を起票します。
- 初回実行はベースライン（現状のハッシュ一覧）を作るだけで、起票はしません。
- 全体の半数超が取得エラーになるような系統的障害時は、誤検知を避けるため何も書かずに異常終了します。

### B. TDnet 新規開示ウォッチ（watch_tdnet_v1.mjs）

- 毎日 06:30 JST、TDnet 適時開示の当日・前日分リスト（Yanoshin の TDnet Web API の日次 Atom）を取得し、タイトルに「中期経営計画」「中計」「事業計画及び成長可能性に関する事項」を含む開示を抽出します。
- 社名の前方一致でユニバース（registry の 3,686 社）と照合し、証券コードが推定できれば付けて inbox に `new_disclosure` として起票します。照合できないものも候補として残します（コードなし）。
- 処理済み URL は `tdnet-seen-v1.json` に記録し、重複起票を防ぎます。日次リストが取れない場合は recent.atom（直近 300 件）へフォールバックします。
- 依存先は非公式 API のため、取得経路は差し替え可能な前提で分離してあります。公式 TDnet への移行は将来課題です。
- 日次リストの収録範囲は API 提供側の仕様に依存します（2026-11-20 の実測では 1 日分 216 件を取得）。決算集中期に上限があるかは未検証であり、取りこぼしの最終的な受け皿は A の一次資料ウォッチと四半期の鮮度再確認です。

### C. 確認と反映（人間 / AI の作業）

- inbox の `status: "open"` を定期的にトリアージします。大量処理の下書きには Gemini 等の無料 API を第一選択にし（オーナー決定 2026-11-20）、数値の確定は必ず一次資料で検証します。
- 反映は既存の手順（override → ビルド → 検証 → PR）に従います。四半期の鮮度再確認も、この inbox を入力の一つにします。
- 処理済みの項目は `status` を `triaged` / `applied` / `dismissed` に更新し、理由を `note` に残します（項目自体は消しません。検知履歴も資産です）。

## ファイル

| ファイル | 役割 | 書き手 |
| --- | --- | --- |
| `source-snapshot-v1.json` | 一次資料 URL ごとのハッシュ・状態 | A（自動） |
| `tdnet-seen-v1.json` | TDnet で処理済みの開示 URL | B（自動） |
| `inbox-v1.json` | 確認待ちキュー（open / triaged / applied / dismissed） | A・B（自動起票）＋ C（状態更新） |

`source-snapshot-v1.json` と `tdnet-seen-v1.json` と `inbox-v1.json` は GitHub Actions が main へ直接コミットする機械管理ファイルです（公開データではないため PR フローの対象外とし、変更はすべて履歴に残ります）。

## ワークフロー

- `.github/workflows/detection-watch-tdnet.yml`：毎日 06:30 JST + 手動実行
- `.github/workflows/detection-watch-sources.yml`：毎週月曜 07:00 JST + 手動実行

どちらも Muse を実行経路に含みません（方針どおり）。
