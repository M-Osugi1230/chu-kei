#!/usr/bin/env python3
"""Validate Phase 2 source-repair quarantine rules.

A source-repair record can explicitly prohibit a collected candidate from
entering primary review. This validator ensures that such a company has not
been marked complete in the canonical Phase 2 ledger and does not already have
a completed primary-review record. It never approves or completes any review.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"top-level JSON must be an object: {path}")
    return value


def assert_false(value: dict[str, Any], key: str, location: str) -> None:
    if value.get(key) is not False:
        raise SystemExit(f"{location}.{key} must be false")


def canonical_completed_codes(status: dict[str, Any]) -> set[str]:
    records = status.get("completedPrimaryReviews")
    if not isinstance(records, list):
        raise SystemExit("completedPrimaryReviews must be an array")

    codes: set[str] = set()
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise SystemExit(f"completedPrimaryReviews[{index}] must be an object")
        code = str(record.get("code", "")).strip()
        if not code:
            raise SystemExit(f"completedPrimaryReviews[{index}] lacks code")
        if code in codes:
            raise SystemExit(f"duplicate completed company code: {code}")
        codes.add(code)
    return codes


def validate_repair(
    repair_path: Path,
    repo_root: Path,
    completed_codes: set[str],
) -> dict[str, Any]:
    repair = load_json(repair_path)
    if repair.get("schemaVersion") != "phase2-source-resolution-v1":
        raise SystemExit(f"unexpected schemaVersion: {repair_path}")

    company = repair.get("company")
    if not isinstance(company, dict):
        raise SystemExit(f"company section missing: {repair_path}")
    code = str(company.get("code", "")).strip()
    if not code:
        raise SystemExit(f"company code missing: {repair_path}")

    assert_false(repair, "primaryReviewComplete", str(repair_path))
    assert_false(repair, "independentReviewReady", str(repair_path))
    assert_false(repair, "automaticFactCompletionAllowed", str(repair_path))
    assert_false(repair, "automaticApprovalAllowed", str(repair_path))
    assert_false(repair, "deepVerificationApproved", str(repair_path))

    incorrect = repair.get("incorrectCandidate")
    quarantined = isinstance(incorrect, dict) and incorrect.get("mayEnterPrimaryReview") is False
    if quarantined:
        if code in completed_codes:
            raise SystemExit(
                f"quarantined source company is marked complete in canonical ledger: {code}"
            )

        review_path = (
            repo_root
            / "operations/quality-rebase/phase2/reviews"
            / f"{code}-primary-review-v1.json"
        )
        if review_path.exists():
            review = load_json(review_path)
            review_state = review.get("review")
            review_status = ""
            if isinstance(review_state, dict):
                review_status = str(review_state.get("status", ""))
            if review_status.startswith("primary_review_complete"):
                raise SystemExit(
                    f"quarantined source has a completed review record: {code}"
                )

    required_checks = repair.get("requiredNextChecks")
    if not isinstance(required_checks, list) or not required_checks:
        raise SystemExit(f"requiredNextChecks missing: {repair_path}")

    return {
        "code": code,
        "quarantined": quarantined,
        "resolutionStatus": repair.get("resolutionStatus"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--status",
        default="operations/quality-rebase/phase2/current-status-v1.json",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    status = load_json(repo_root / args.status)
    if status.get("automaticDeepApprovalAllowed") is not False:
        raise SystemExit("canonical status must prohibit automatic deep approval")

    completed_codes = canonical_completed_codes(status)
    repair_dir = repo_root / "operations/quality-rebase/phase2/source-repairs"
    repair_paths = sorted(repair_dir.glob("*-source-resolution-v1.json"))
    if not repair_paths:
        raise SystemExit("no source-resolution records found")

    results = [
        validate_repair(path, repo_root, completed_codes)
        for path in repair_paths
    ]

    print(
        json.dumps(
            {
                "status": "ok",
                "sourceResolutionRecords": len(results),
                "quarantinedCompanies": sum(
                    1 for result in results if result["quarantined"]
                ),
                "deepVerificationApproved": 0,
                "records": results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
