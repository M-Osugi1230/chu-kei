# v43 date semantics

## `planPublishedDate`

対象となる中期経営計画、中計相当資料、または経営方針資料が公式に公表された日。

- 日単位確認: `YYYY-MM-DD`
- 月単位確認: `YYYY-MM`
- 年単位確認: `YYYY`
- 未確認: `null`

確認日を代用してはならない。

## `datePrecision`

`planPublishedDate`の確認粒度。

- `day`
- `month`
- `year`
- `unconfirmed`

## `lastVerifiedDate`

Chu-kei運営が公式ソースの存在・内容を最後に確認した日。資料の公表日ではない。

## 表示原則

画面では「資料公表日」と「ソース確認」を別のラベルで表示する。どちらかが未確認の場合、もう一方を補完値として表示しない。
