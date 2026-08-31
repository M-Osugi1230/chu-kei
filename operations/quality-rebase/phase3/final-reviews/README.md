# Phase 3 final review audit records

このディレクトリは、別役割の final reviewer が会社ごとに行った Phase 3 最終確認の監査記録を保存します。

## 原則

- blocker がないことだけを理由に承認しない。
- 一次レビュー担当・独立レビュー担当と同じ役割のまま最終承認しない。
- 自動承認・一括承認は禁止する。
- 会社ごとに一次レビュー、独立completion、独立review packetを再確認する。
- 資料同一性、年度、単位、対象範囲、戦略・数値、資本政策、株主還元を確認する。
- 根拠不足なら `deferred` とし、理由を明記する。
- `approved` は必要チェックをすべて満たした会社だけに付与する。
- 421A は `post_publication_link_and_render_check` が残る間は承認しない。

## ファイル名

`<company-code>-final-review-v1.json`

## 必須形式

```json
{
  "schemaVersion": "quality-rebase-phase3-final-review-v1",
  "company": { "code": "2146", "name": "UTグループ" },
  "decision": "approved",
  "reviewedAt": "2026-08-30T00:00:00+09:00",
  "reviewer": {
    "role": "final_reviewer",
    "separateFromPrimaryReviewer": true,
    "separateFromIndependentReviewer": true
  },
  "evidence": {
    "reviewedFiles": [
      "operations/quality-rebase/phase2/reviews/2146-primary-review-v1.json",
      "operations/quality-rebase/phase2/independent-completions/2146-independent-completion-v1.json",
      "operations/quality-rebase/phase2/independent/2146-independent-review-v1.json"
    ]
  },
  "checks": {
    "sourceIdentityConfirmed": true,
    "yearUnitScopeConfirmed": true,
    "strategyMetricsConfirmed": true,
    "capitalAndReturnPolicyConfirmed": true,
    "auditRecordComplete": true
  },
  "reasons": [],
  "policy": {
    "selfApprovalAllowed": false,
    "automaticApprovalAllowed": false
  },
  "deepVerificationApproved": true
}
```

`decision` は `approved` または `deferred` のみです。`deferred` の場合は `deepVerificationApproved=false` とし、`reasons` に1件以上の具体的理由を記録します。
