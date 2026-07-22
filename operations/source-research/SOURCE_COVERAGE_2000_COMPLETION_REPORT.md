# Chu-kei 本番品質2,000社 完了監査

- 監査日: 2026-07-22
- 対象リポジトリ: `M-Osugi1230/chu-kei`
- 対象ブランチ: `agent/production-quality-2000`
- 目的: 掲載2,500社のうち、本番品質要件を満たす企業を2,000社まで拡張する

## 1. 完了状態

| 指標 | 完了値 |
|---|---:|
| 掲載企業 | 2,500社 |
| 本番品質 | 2,000社 |
| 5つ星品質 | 2,000社 |
| 機械品質要件充足 | 2,000社 |
| 一次レビュー・独立再検証済み | 2,000社 |
| Coverageβ | 500社 |
| 公式資料確認率 | 80.00% |
| 承認待ち | 0社 |
| 機械補修キュー | 0社 |

最終データバンドルSHA-256:

`89b173fcbea413b4ab31ebc48726a24907002818af5148b6e3c30255e0521acc`

## 2. 調査範囲

第13〜17回の公式資料調査を連続実行し、これまで未調査だった500社を100社ずつ調査した。

調査では次を確認した。

- JPX企業コード別の公式開示資料
- 企業名または証券コードによる企業同一性
- 資料公表日
- PDFページ数
- 具体的なページ証跡
- 中期・中長期・経営計画・経営戦略等の資料種別
- 戦略テーマ
- 財務・資本政策等の構造化概要

## 3. 統合評価

過去第1〜17回の候補レポートを統合し、現在も`jpx_indexed`である企業だけを昇格候補として再評価した。

| 統合評価 | 件数 |
|---|---:|
| 統合候補 | 2,195社 |
| 品質条件通過 | 457社 |
| 明示承認・昇格対象 | 451社 |
| 次回候補として保留 | 6社 |
| 条件未充足・現在ステージ対象外 | 1,738社 |

過去バッチ間で同じ証券コードが存在する場合は、次の順序で品質の高い候補を決定論的に採用した。

1. 候補ステータス
2. 企業同一性
3. 信頼度
4. 資料公表日
5. PDFページ数
6. ページ証跡数

## 4. 提案の固定

- 提案ファイル: `operations/source-research/source-research-batches-001-017-production-2000-proposal.json`
- 提案SHA-256:

`5a562fa11348656b89cbeaff8e49c5cbbe35cf88b02e970ee8c45045b11977aa`

- 提案時データバンドルSHA-256:

`c7515c7817686fb2a71e51909016cd06b074a9f478454ac9aad80414a8a3039f`

提案は451社の証券コードを含む同一性情報として固定した。生成後に対象を自動追加・差し替えしていない。

## 5. 明示承認と本番昇格

### 公式資料候補の承認

- 承認ID: `source-research-bulk-approval-013`
- 構造化バッチ: `structured-expansion-batch-83`
- 承認件数: 451社
- 構造化前: 1,549社
- 構造化後: 2,000社

### 本番品質への昇格

- 承認ID: `production-bulk-promotion-approval-010`
- 昇格バッチ: `production-promotion-batch-359`
- 本番品質昇格前: 1,549社
- 本番品質昇格後: 2,000社
- 一次レビュー担当: `production-quality-review-2000`
- 独立再検証担当: `independent-release-review-2000`

## 6. 安全策

今回の拡張でも次を禁止した。

- 自動事実補完
- 未確認数値の推計補完
- 自動選定
- 自動承認
- 自動本番昇格
- 比較不能な数値への架空の進捗率付与
- ステージ名や品質ラベルの一括置換による数合わせ

また、現在ステージを提案条件に含め、すでに本番品質である企業の重複昇格を防止した。

## 7. 品質要件

本番品質2,000社について、次の要件を監査対象とした。

- 公式一次資料
- 資料公表日
- 具体的なページ証跡または公式Web見出し
- 構造化分析
- 数値抽出
- 進捗評価
- 鮮度
- 一次レビュー
- 独立再検証
- 企業同一性
- データ契約整合
- 証券コード重複防止

## 8. 最終監査対象

次のワークフローを最新の2,000社データで実行する。

- Chu-kei v43 Quality Gate
- Apply Structured Source of Truth
- Data Contract Gate
- Normalize Chu-kei Data Contract
- Quality Dashboard Gate
- Quality Debt Budget
- Source Audit
- Source Evidence Candidates
- Review Governance
- Entity Identity Audit
- Production Repair Queue
- Search and Filter Contract
- Release and Deployment Gate
- Browser E2E
- Accessibility and Performance

全監査成功後にPRをmainへ反映する。
