# Chu-kei v43 Release Manifest

## Release

- Name: Chu-kei 570社 Quality Hardened Beta v43
- Release date: 2026-07-10
- Public package: `chukei_570_company_quality_hardened_v43.zip`
- Operations package: `chukei_570_company_quality_operations_v43.zip`

## Package checksums

```text
ce7662cd84b992379949e7cb5da7215cec862fd57794b9cc162a21e226efc129  chukei_570_company_quality_hardened_v43.zip
111745b17c1972d347710f948c1e2233cef8b9b1923e13a3bc21e3ef2c1d7d1a  chukei_570_company_quality_operations_v43.zip
```

## Main artifacts

- 570社公開用静的サイトZIP
- 570社運用パッケージZIP
- 570社品質マトリクスCSV
- 品質改善キューCSV
- 品質強化レポート
- 深層データ品質QA
- ブラウザ操作QA
- 静的アクセシビリティQA

## Data depth

- 本番: 30社
- 詳細抽出済みβ: 70社
- 一次確認β: 100社
- カバレッジβ: 370社
- 合計: 570社
- 中計ソース確認済み: 200社
- 主要論点構造化済み: 100社
- 進捗DB登録: 44社 / 149行
- 実績接続: 16社

## Quality gates

- Deep quality: 36 / 36 PASS
- Browser interaction: 28 / 28 PASS
- Static accessibility: PASS
- Desktop console errors: 0
- Mobile console errors: 0
- Re-extracted ZIP validation: PASS

## Repository upload note

GitHub上にはリリース構成、QA、品質方針、SHA-256を保存する。元ZIPの実体を取得できる環境では、`SOURCE_PACKAGE_IMPORT.md`に従って展開し、静的サイト本体と運用データを追加する。
