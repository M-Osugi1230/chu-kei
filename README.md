# Chu-kei

日本上場企業の中期経営計画ポータル。

企業が中期経営計画で示す経営課題、成長戦略、財務目標、資本政策、株主還元、進捗状況を整理・比較するための静的Webサイトです。

## Current release

- Version: v43
- Release: 570社 Quality Hardened Beta
- Coverage: 570 companies
- Detailed production data: 30 companies
- Detailed beta data: 70 companies
- Source-confirmed beta data: 100 companies
- Coverage beta data: 370 companies
- Progress database: 44 companies / 149 rows
- Actuals connected: 16 companies

## Quality status

- Deep data quality checks: 36 / 36 PASS
- Browser interaction checks: 28 / 28 PASS
- Static accessibility audit: PASS
- Desktop console errors: 0
- Mobile console errors: 0

## Repository structure

- `releases/v42/` v42 release manifest
- `reports/v42/` v42 QA and completion reports
- `data/v42/` v42 master data, audits, and promotion queue
- `releases/v43/` v43 release manifest, checksums, and import notes
- `reports/v43/` v43 quality report and QA results

## Important data quality note

570社すべてを同一品質として扱いません。企業探索カバレッジ、中計ソース確認済み、主要論点構造化済み、本番品質を明確に分離しています。未確認情報は推測で補完しません。

資料公表日とソース確認日を分離し、未レビュー・未確認・未開示を区別します。Chu-keiは投資助言・銘柄推奨を目的とするサービスではありません。

## Source packages

最新版の静的配布物と運用配布物は、次のZIPとして作成済みです。

- `chukei_570_company_quality_hardened_v43.zip`
- `chukei_570_company_quality_operations_v43.zip`

チェックサムと取り込み方法は [`releases/v43/`](releases/v43/) を参照してください。
