# Chu-kei Universe-first Architecture v1

## Goal

Chu-keiの企業数網羅性を、1社あたりの詳細情報網羅性より優先する。

Prime / Standard / Growth の現行上場企業を検索母集団として100%保持し、その上で中期経営計画の存在確認、Comparison Core、必要時のDeep Researchを段階的に積み上げる。

## Product principle

- 企業は広く100%
- 情報は比較に必要な分から
- Deep Researchは必要になった企業だけ
- 既存の高品質データは捨てずGold Datasetとして維持
- 未確認を推測で補完しない
- 企業が検索に存在しない状態を最優先で解消する

## Data layers

### L0 Universe

Prime / Standard / Growth の現行上場全社。

最低限保持する項目:

- 証券コード
- 企業名
- 市場区分
- 33業種
- 上場状態
- JPX source
- 最終同期日時

L0は公式JPX一覧から機械同期してよい。これは中計内容の自動承認ではない。

### L1 Plan Detection

全L0企業について、中期経営計画の状態を管理する。

状態候補:

- current
- expired
- no_formal_plan
- found_unstructured
- not_checked

「データがない」と「正式中計が存在しない」を分離する。

### L2 Comparison Core

企業横断比較に必要な最小項目を構造化する。

優先項目:

- 計画期間
- 売上目標
- 営業利益・利益目標
- 収益性
- ROE / ROIC 等の資本効率
- 成長戦略
- 資本配分
- 株主還元
- 最新進捗
- 公式根拠

### L3 Deep Research

詳細情報は全社一律で埋めない。

比較・検索・ユーザー需要によって必要性が発生した企業を対象に、過去中計、セグメントKPI、CAPEX、M&A予算、人的資本等を追加する。

## Priority order

1. Universe Coverage
2. Listing identity / market accuracy
3. Plan Detection Coverage
4. Comparison Core Coverage
5. Freshness
6. Evidence quality
7. Deep Research

Deep ResearchはUniverse CoverageとComparison Coreを妨げてはならない。

## Core KPIs

- Universe Coverage: 100%
- Search Presence Coverage: 100%
- Listing Status Accuracy: 100%
- Plan Detection Coverage
- Comparison Core Coverage
- Evidence Coverage
- Freshness
- Query Answerability
- Time to Insight

Deep Research Coverageには100%目標を置かない。

## Existing data treatment

既存の詳細データは削除・簡略化しない。

- 既存の比較可能・詳細企業群: Gold Dataset
- 既存3,000社掲載: Breadth Dataset
- JPX主要3市場全社: Universe Dataset

FrontendではUniverseを検索母集団とし、同一コードに既存データがあれば既存の詳細情報を優先してマージする。

## Completion definition

Chu-kei v1の完成条件は「全企業の全項目が埋まること」ではない。

以下を満たした状態をProduction Graduationとする。

1. Prime / Standard / Growth の全現行上場企業が検索可能
2. 各社の中計確認状態が分かる
3. Core項目で企業横断検索・比較ができる
4. 目標と進捗を確認できる
5. 根拠となる公式資料へ戻れる
6. 不足情報は需要に応じてResearch Queueへ送れる
7. 新規上場・市場変更・上場廃止候補を継続検知できる

## ADE role

ADEのGoalは「データを増やす」ではなく「Chu-keiの企業発見・比較能力を最大化する」。

Backlogは次の順に生成する。

1. Universe missing
2. Plan status not checked
3. Comparison-blocking Core gap
4. Stale Core data
5. Evidence gap
6. Deep Research request

Research Priorityは概念的に次で評価する。

Comparison Impact × User Demand × Gap Severity × Freshness Importance / Research Cost

この順序により、詳細データ改善が目的化することを防ぐ。


## ADE executable research queue

`scripts/build_research_priority_queue_v1.mjs` converts the architecture into an executable backlog.

### L1 priority

All `not_checked` companies enter `L1_PLAN_DETECTION`.

Existing document titles, source URLs, publication dates and evidence references may raise research priority as candidate hints, but they never change Plan Detection status automatically. A resolved status still requires the evidence gate defined by the Plan Detection registry.

### L2 priority

Only companies already resolved as `current` or `found_unstructured` are evaluated for Comparison Core gaps.

The initial Core readiness model uses:

- period
- revenue
- profit
- margin
- capital
- returnPolicy
- strategy themes
- official evidence
- progress

Missing fields are weighted by comparison impact and placed in `L2_COMPARISON_CORE`. The queue asks ADE to fill only the missing comparison-blocking fields.

### L3 rule

Deep Research is not generated from generic data incompleteness. It is created only from user demand or an explicit research goal.

Generated artifacts:

- `operations/research-priority/current-v1.json`
- `site/data/research-priority-summary-v1.json`

This keeps the autonomous loop aligned with product value instead of raw data volume.


## Verified L1 seed from historical independent reviews

Phase 2 independent-review completions are reused as L1 evidence only when all of the following are true:

- independent review status is complete
- source identity is explicitly confirmed
- independent reviewer result is confirmed
- a first-party or official source URL is present
- formal-plan existence is explicit in the reviewed record
- current / expired status can be derived from the reviewed plan end date

The importer never promotes unresolved records. Those stay `not_checked`.

Generated artifact:

- `operations/plan-detection/verified-overrides-v1.json`

The override is provenance-preserving and recalculates plan currentness against the current Tokyo date, so a previously current plan can become `expired` automatically after its reviewed end date. A newer manually reviewed L1 record takes precedence over an older imported review.
