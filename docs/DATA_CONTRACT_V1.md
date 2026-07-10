# Chu-kei データ契約 v1

## 目的

企業数を増やしても項目名・品質状態・日付の意味が崩れないよう、公開データの最低契約を固定する。

## 正本

- `schemas/bundle-v1.schema.json`
- `schemas/company-v1.schema.json`
- `schemas/progress-v1.schema.json`
- `schemas/quality-profile-v1.schema.json`
- `scripts/validate_data_contract_v1.mjs`

## 日付

- `planPublishedDate`: 中計または対象資料の公表日。未確認は `null` または省略。
- `lastVerifiedDate`: Chu-keiが公式ソースを最後に確認した日。日単位のISO形式を必須とする。
- 旧 `date` は禁止する。

## 品質階層

- `core`: 本番
- `detailed_extracted`: 詳細抽出済みβ
- `source_indexed`: 一次確認β
- `jpx_indexed`: カバレッジβ

カバレッジβは品質スコアを算定せず、未確認の中計数値・戦略を保持しない。

## 変更管理

破壊的変更は既存キーの意味を書き換えず、新しいschema versionを追加する。CIを通過しないデータは公開しない。
