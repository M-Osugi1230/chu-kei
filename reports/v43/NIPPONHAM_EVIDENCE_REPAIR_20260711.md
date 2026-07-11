# 日本ハム（2282）証跡補修記録

## 実施日

2026-07-11

## 対象

- 会社: 日本ハム株式会社
- 証券コード: 2282
- 資料: 中期経営計画2026
- 公式PDF: `https://www.nipponham.co.jp/corporate/ir/library/briefing-session/pdf/20240517.pdf`

## 確認した原文

- p.1: 資料日付 `2024/5/17`
- p.9: 2029年3月期の事業利益 `790億円以上`
- p.10: 2027年3月期の売上高 `13,800億円`、事業利益 `610億円`、事業利益率 `4.4%`、ROE `7-8%`、ROIC `5-6%`
- p.10: 2030年3月期のROE `9%以上`、ROIC `7%以上`

## 修正内容

- `planPublishedDate`: 未確認 → `2024-05-17`
- 売上高・事業利益・事業利益率・資本効率の表現をPDF原文へ更新
- ページ番号付きの`evidenceRefs`へ更新
- PDF追加抽出が必要という旧警告を削除
- 品質スコアを再計算

## 品質負債の改善

- 本番の資料公表日不足: 4社 → 3社
- 本番のページ証跡不足: 23社 → 22社
- 本番の★★★★★未達: 23社 → 22社

## 変更管理

- Patch: `operations/patches/nipponham-evidence-20260711.json`
- Review decision: `review-2282-20260711-nipponham-evidence`
- Correction: `correction-2282-20260711-publication-evidence`
- Bundle SHA-256: `6c62948d5a204a849f8db3ede742d1f5a22cafd0d9c4f524806a7c89cdee76a2`

本補修は公式PDFに明記された内容のみを反映し、未確認情報の推測補完や品質階層の自動昇格は行っていない。
