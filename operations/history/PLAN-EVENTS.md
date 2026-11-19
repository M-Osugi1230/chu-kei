# 変更履歴（plan-events v1）

会社ごとに「いつ・何が・どう変わったか」を時系列で引けるイベントログです。収益化方針（Notion 共有資料「⑤ 収益化方針」）で中核資産とした「検証済みデータとその変更履歴」の実体であり、データライセンスとアラートの土台になります。

データ: `operations/history/plan-events-v1.json`（このディレクトリ）。

## 設計原則

- **AI トークンを基本使わない**（オーナー指示 2026-11-20）。イベントの生成・蓄積は決定的なスクリプト処理だけです。AI が関与するのは、将来アラートやレポートで「変更の要約文」が要るときに限ります。その場合も無料 API（Gemini 等）でバッチ生成し、結果をイベントにキャッシュして再計算しません。
- **日付の正直さ**：各イベントは `dateBasis` を持ちます。`verified` = 私たちが一次資料を確認した日、`disclosed` = 出典が示す公表日。意味の違う日付を混ぜません。
- **追記のみ（append-only）**：イベントは削除・改変しません。誤りが判明したら訂正イベントを足し、元のイベントを指します。
- イベントは「私たちの観測・検証の記録」です。会社の公表内容そのものの主張は、出典（sourceUrl と文書ハッシュ）に帰します。

## イベント形式

```json
{
  "id": "1430-2026-01-14-plan_superseded-ab12cd34",
  "code": "1430",
  "name": "ファーストコーポレーション",
  "date": "2026-01-14",
  "dateBasis": "disclosed",
  "kind": "plan_superseded",
  "sourceUrl": "https://www.1st-corp.com/ir/plan/",
  "sourceTitle": "First VISION 2031（フェーズ1）",
  "documentSha256": null,
  "previousSourceUrl": "https://www2.jpx.co.jp/disc/14300/140120240722552209.pdf",
  "previousDocumentSha256": "5920156a…",
  "recordedVia": "reverification_2026_11"
}
```

## kind 一覧

| kind | 意味 | 主な発生源 |
| --- | --- | --- |
| `registered_plan` | その文書を登録済み計画として確認した | registry |
| `verified_unchanged` | 再確認で文書・内容に変化なし | 鮮度再確認 |
| `verified_with_notes` | 再確認で変化なし（注記あり） | 鮮度再確認 |
| `plan_superseded` | 後継計画が公表され、旧計画が置き換わった | 鮮度再確認・検知 |
| `source_url_changed` | 出典 URL が変わった | 鮮度再確認・検知 |
| `plan_withdrawn` | 計画の撤回・終了を確認した | 鮮度再確認・検知 |
| `document_changed` | 登録文書の中身が差し替わった | 検知（一次資料ウォッチ） |
| `new_plan_published` | 新規の中計公表を登録した | 検知（TDnet ウォッチ） |

## 生成と追記

- シード生成：`scripts/history/build_plan_events_v1.mjs` が registry（500 社の登録記録）、#288 鮮度再確認の判定記録 3,000 件、検知スナップショット（現行文書のハッシュ）から機械的に生成します。再実行しても同じ結果になり、`recordedVia` が `detection_inbox` のイベント（将来の追記分）は保持されます。
- 今後の追記：検知 inbox の項目を検証して公開データへ反映する際、その反映 PR の中で対応するイベントを追記します（`recordedVia: "detection_inbox"`、検知項目の id を `detectionId` に記録）。
- 四半期の鮮度再確認でも、判定結果から同じ形式でイベントを追記します。
