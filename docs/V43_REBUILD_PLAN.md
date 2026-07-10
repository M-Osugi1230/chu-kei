# Chu-kei v43 再構築計画

## 目的

v42運用パッケージを正本として、Chu-keiを再現可能・監査可能なv43へ移行する。

## 守る原則

1. 企業探索570社と中計構造化100社を混同しない。
2. 推測で空欄を埋めない。
3. 未確認・未レビュー・未開示を区別する。
4. 資料公表日とソース確認日を分離する。
5. 投資助言、銘柄推奨を目的としない。
6. 品質ゲートを通過しない変更は公開しない。

## 正本ディレクトリ

公開サイトは `site/` を正本とする。

```text
site/
├── index.html
├── 404.html
├── assets/
├── data/
├── docs/
├── scripts/
├── manifest.webmanifest
├── robots.txt
└── _headers
```

運用元データと生成処理は将来的に以下へ分離する。

```text
operations/
├── source/
├── queues/
├── scripts/
└── reports/
```

## 移行フェーズ

### Step 1: v43品質基盤

- Node.jsによる依存関係なしの品質監査
- GitHub ActionsによるPR・main品質ゲート
- JSON監査レポートのArtifact保存
- 570社、品質階層、日付意味、進捗DB、禁止表現を検証

### Step 2: v42サイト本体の移管

`chukei_570_company_public_beta_v42.zip` の中身を `site/` 配下へ配置する。

配置後はCIがbootstrap modeからstrict modeへ自動的に切り替わる。

### Step 3: 日付モデルのv43化

従来の曖昧な `date` を廃止方向とし、次のフィールドへ移行する。

- `planPublishedDate`: 中期経営計画または対象資料の公表日
- `planPublishedDatePrecision`: `day` / `month` / `year` / `unknown`
- `lastVerifiedDate`: 運営側が公式ソースを最後に確認した日

互換期間中は `date` を読み取り可能とするが、新規更新では使用しない。

### Step 4: 品質プロファイル

各企業に機械判定可能な品質プロファイルを持たせる。

- 公式資料確認
- 資料公表日確認
- 出典ページ番号
- 数値確認
- 進捗DB接続
- 人手レビュー
- ダブルチェック

星表示は手入力ではなく、これらの根拠項目から算出する。

### Step 5: 本番100社への昇格

本番昇格条件を満たす70社を順次レビューし、30社から100社へ昇格する。

## Definition of Done

- `npm run quality:v43` がstrict modeで成功する。
- 570社のコードが一意である。
- 本番30、詳細抽出70、一次確認100、Coverage 370が一致する。
- 公表日と確認日を画面・データ双方で混同しない。
- 進捗149行に重複・孤立・計算不整合がない。
- Coverageβに推測された分析内容が存在しない。
- QA結果をGitHub Actions Artifactとして取得できる。
