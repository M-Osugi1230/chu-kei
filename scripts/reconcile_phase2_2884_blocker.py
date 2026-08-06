#!/usr/bin/env python3
"""Reconcile Phase 2 records for company 2884 without inferring completion.

The official document confirms a management roadmap, but states that quantified
medium-term targets are under reconsideration. The source-resolution record
therefore blocks completion until a quantified formal plan is republished.
This script demotes the inconsistent completed records across the Wave 4 queue,
canonical ledger, primary-review record, and independent-review queue.

It is intentionally idempotent and never grants approval.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PHASE2 = ROOT / "operations/quality-rebase/phase2"
CODE = "2884"
UPDATED_AT = "2026-08-04T05:20:00+00:00"
RESOLUTION_FILE = (
    "operations/quality-rebase/phase2/source-repairs/"
    "2884-source-resolution-v1.json"
)
REVIEW_FILE = "operations/quality-rebase/phase2/reviews/2884-primary-review-v1.json"
INDEPENDENT_FILE = (
    "operations/quality-rebase/phase2/independent/"
    "2884-independent-review-v1.json"
)
BLOCKED_STATUS = "primary_review_assigned_formal_plan_boundary_required"
REVIEW_BLOCKED_STATUS = (
    "primary_review_blocked_quantified_plan_republication_required"
)


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"top-level JSON must be an object: {path}")
    return value


def write(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def find_company(rows: list[Any], code: str, location: str) -> dict[str, Any]:
    matches = [
        row
        for row in rows
        if isinstance(row, dict) and str(row.get("code", "")) == code
    ]
    if len(matches) != 1:
        raise SystemExit(
            f"expected exactly one company {code} in {location}, found {len(matches)}"
        )
    return matches[0]


def reconcile_wave() -> None:
    path = PHASE2 / "primary-review-wave04-v1.json"
    wave = load(path)
    companies = wave.get("companies")
    if not isinstance(companies, list):
        raise SystemExit("Wave 4 companies must be an array")

    company = find_company(companies, CODE, "Wave 4")
    status = company.get("status")
    allowed = {
        "primary_review_complete_independent_review_ready",
        BLOCKED_STATUS,
    }
    if status not in allowed:
        raise SystemExit(f"unexpected Wave 4 status for {CODE}: {status}")

    company["status"] = BLOCKED_STATUS
    company.pop("reviewFile", None)
    company.pop("independentReviewFile", None)
    company.pop("completedChecks", None)
    company["sourceResolutionFile"] = RESOLUTION_FILE
    company["blockingReason"] = "quantified_medium_term_targets_under_reconsideration"
    company["requiredNextAction"] = (
        "計数目標を含む正式な中期経営計画の再公表後に、資料同一性と中計境界を再確認する"
    )
    company["automaticApprovalAllowed"] = False
    company["deepVerificationApproved"] = False

    counts = wave.get("counts")
    if not isinstance(counts, dict):
        raise SystemExit("Wave 4 counts must be an object")
    counts["primaryReviewComplete"] = sum(
        1
        for row in companies
        if isinstance(row, dict)
        and row.get("status") == "primary_review_complete_independent_review_ready"
    )
    counts["independentReviewReady"] = counts["primaryReviewComplete"]
    counts["deepVerificationApproved"] = 0
    wave["updatedAt"] = UPDATED_AT
    write(path, wave)


def reconcile_primary_review() -> None:
    path = ROOT / REVIEW_FILE
    review = load(path)

    company = review.get("company")
    if not isinstance(company, dict) or str(company.get("code", "")) != CODE:
        raise SystemExit("primary-review company code mismatch")

    source = review.get("source")
    if not isinstance(source, dict):
        raise SystemExit("primary-review source section missing")
    source["documentClassification"] = (
        "official_management_roadmap_with_quantified_targets_under_reconsideration"
    )
    source["completionEligibility"] = "blocked_pending_quantified_plan_republication"
    source["sourceResolutionFile"] = RESOLUTION_FILE

    validation = review.get("validation")
    if not isinstance(validation, dict):
        raise SystemExit("primary-review validation section missing")
    validation["formalPlanConfirmed"] = False
    validation["formalPlanBoundaryValidated"] = False
    validation["quantifiedFormalPlanAvailable"] = False
    validation["primaryReviewCompletionEligible"] = False
    validation["independentDoubleCheck"] = False

    review_state = review.get("review")
    if not isinstance(review_state, dict):
        raise SystemExit("primary-review review section missing")
    review_state["status"] = REVIEW_BLOCKED_STATUS
    review_state["automaticFactCompletionAllowed"] = False
    review_state["automaticApprovalAllowed"] = False
    review_state["deepVerificationApproved"] = False
    review_state["blocker"] = {
        "type": "quantified_formal_plan_not_currently_available",
        "sourceResolutionFile": RESOLUTION_FILE,
        "statement": (
            "現行資料は戦略ロードマップを示すが、計数目標は再検討中である。"
            "正式な計数目標が再公表されるまで一次レビュー完了として扱わない。"
        ),
    }
    review_state["remainingChecks"] = [
        "計数目標を含む正式中期経営計画の再公表確認",
        "再公表資料の公式URL・PDFハッシュ・ページ数の再取得",
        "2030年2月期の計数目標と2027年2月期単年度予想の境界再確認",
        "再公表後の全文・図表・年度・単位・範囲の再検証",
        "独立確認者による再確認",
    ]
    write(path, review)


def reconcile_status() -> None:
    path = PHASE2 / "current-status-v1.json"
    status = load(path)

    completed = status.get("completedPrimaryReviews")
    if not isinstance(completed, list):
        raise SystemExit("completedPrimaryReviews must be an array")
    status["completedPrimaryReviews"] = [
        row
        for row in completed
        if not (isinstance(row, dict) and str(row.get("code", "")) == CODE)
    ]

    review = status.get("review")
    if not isinstance(review, dict):
        raise SystemExit("canonical review section missing")
    complete_count = len(status["completedPrimaryReviews"])
    ready_count = sum(
        1
        for row in status["completedPrimaryReviews"]
        if isinstance(row, dict)
        and row.get("status") == "primary_review_complete_independent_review_ready"
    )
    review["sourceIdentityConfirmed"] = complete_count
    review["formalPlanConfirmed"] = complete_count
    review["primaryReviewComplete"] = complete_count
    review["independentReviewReady"] = ready_count
    review["remainingPrimaryReviews"] = 450 - complete_count
    review["deepVerificationApproved"] = 0

    findings = status.get("qualityFindings")
    if not isinstance(findings, list):
        raise SystemExit("qualityFindings must be an array")
    findings = [
        row
        for row in findings
        if not (isinstance(row, dict) and str(row.get("code", "")) == CODE)
    ]
    findings.append(
        {
            "code": CODE,
            "name": "ヨシムラ・フード・ホールディングス",
            "finding": "quantified_formal_plan_boundary_not_met",
            "resolutionFile": RESOLUTION_FILE,
            "status": "quantified_plan_republication_required_primary_review_blocked",
        }
    )
    status["qualityFindings"] = findings

    active = status.get("activeWork")
    if not isinstance(active, list):
        raise SystemExit("activeWork must be an array")
    wave4 = find_company(
        [row for row in active if isinstance(row, dict)],
        "",
        "unused",
    ) if False else None
    wave4_rows = [
        row
        for row in active
        if isinstance(row, dict) and row.get("workstream") == "primary_review_wave04"
    ]
    if len(wave4_rows) != 1:
        raise SystemExit("primary_review_wave04 activeWork record missing or duplicated")
    wave4_record = wave4_rows[0]
    wave4_record["status"] = "in_progress"
    wave4_record["completionCount"] = 9
    wave4_record["remainingCount"] = 1

    queue_rows = [
        row
        for row in active
        if isinstance(row, dict)
        and row.get("workstream") == "independent_review_ready_queue"
    ]
    if len(queue_rows) != 1:
        raise SystemExit("independent_review_ready_queue record missing or duplicated")
    queue = queue_rows[0]
    files = queue.get("files")
    if not isinstance(files, list):
        raise SystemExit("independent review queue files must be an array")
    queue["files"] = [item for item in files if item != INDEPENDENT_FILE]
    queue["companies"] = len(queue["files"])
    queue["completionCount"] = 0

    blocked_rows = [
        row
        for row in active
        if isinstance(row, dict)
        and row.get("workstream") == "quantified_plan_republication_2884"
    ]
    blocked_record = {
        "workstream": "quantified_plan_republication_2884",
        "companies": 1,
        "status": "external_republication_pending",
        "completionCount": 0,
        "file": RESOLUTION_FILE,
    }
    if blocked_rows:
        blocked_rows[0].update(blocked_record)
    else:
        active.append(blocked_record)

    next_order = status.get("nextProcessingOrder")
    if not isinstance(next_order, list):
        raise SystemExit("nextProcessingOrder must be an array")
    instruction = (
        "ヨシムラ・フード・ホールディングスは計数目標を含む正式中計の再公表まで"
        "一次レビューを保留し、単年度予想やM&A選定基準を中計目標へ流用しない"
    )
    status["nextProcessingOrder"] = [instruction] + [
        item for item in next_order if item != instruction
    ]

    status["updatedAt"] = UPDATED_AT
    write(path, status)


def remove_independent_packet() -> None:
    path = ROOT / INDEPENDENT_FILE
    if path.exists():
        path.unlink()


def main() -> None:
    reconcile_wave()
    reconcile_primary_review()
    reconcile_status()
    remove_independent_packet()
    print(
        json.dumps(
            {
                "status": "reconciled",
                "code": CODE,
                "primaryReviewComplete": False,
                "independentReviewReady": False,
                "deepVerificationApproved": False,
                "sourceResolutionFile": RESOLUTION_FILE,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
