#!/usr/bin/env python3
"""Validate Phase 2 source-repair and source-resolution safety.

Two source-resolution states are supported:

1. A wrong or unresolved candidate is quarantined and must not enter primary
   review.
2. Candidate metadata is corrected to a newer official formal-plan document.
   The corrected source may already have a completed primary review, but only
   when the canonical ledger points back to the same resolution record.

This validator never approves a review, infers a fact, or converts a pending
record into a completed one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

LEGACY_SCHEMA = "phase2-source-resolution-v1"
CORRECTED_SCHEMA = "quality-rebase-phase2-source-resolution-v1"
FORBIDDEN_TRUE_KEYS = {
    "automaticFactCompletionAllowed",
    "automaticApprovalAllowed",
    "deepVerificationApproved",
}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


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


def assert_no_automatic_approval(value: Any, location: str = "root") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            child_location = f"{location}.{key}"
            if key in FORBIDDEN_TRUE_KEYS and child is True:
                raise SystemExit(f"forbidden true flag at {child_location}")
            if key == "status" and isinstance(child, str):
                normalized = child.lower()
                if "approved" in normalized or "deep_verified" in normalized:
                    raise SystemExit(f"approved status is forbidden at {child_location}")
            assert_no_automatic_approval(child, child_location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_automatic_approval(child, f"{location}[{index}]")


def require_false(value: dict[str, Any], key: str, location: str) -> None:
    if value.get(key) is not False:
        raise SystemExit(f"{location}.{key} must be false")


def canonical_completed_records(status: dict[str, Any]) -> dict[str, dict[str, Any]]:
    records = status.get("completedPrimaryReviews")
    if not isinstance(records, list):
        raise SystemExit("completedPrimaryReviews must be an array")

    result: dict[str, dict[str, Any]] = {}
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise SystemExit(f"completedPrimaryReviews[{index}] must be an object")
        code = str(record.get("code", "")).strip()
        if not code:
            raise SystemExit(f"completedPrimaryReviews[{index}] lacks code")
        if code in result:
            raise SystemExit(f"duplicate completed company code: {code}")
        result[code] = record
    return result


def company_code(repair: dict[str, Any], repair_path: Path) -> str:
    company = repair.get("company")
    if not isinstance(company, dict):
        raise SystemExit(f"company section missing: {repair_path}")
    code = str(company.get("code", "")).strip()
    if not code:
        raise SystemExit(f"company code missing: {repair_path}")
    return code


def validate_official_url(value: Any, location: str) -> None:
    if not isinstance(value, str) or not value:
        raise SystemExit(f"officialUrl missing: {location}")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise SystemExit(f"officialUrl must be an absolute HTTPS URL: {location}")


def validate_legacy_quarantine(
    repair: dict[str, Any],
    repair_path: Path,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    code = company_code(repair, repair_path)

    for key in (
        "primaryReviewComplete",
        "independentReviewReady",
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        require_false(repair, key, str(repair_path))

    incorrect = repair.get("incorrectCandidate")
    quarantined = isinstance(incorrect, dict) and incorrect.get("mayEnterPrimaryReview") is False
    if not quarantined:
        raise SystemExit(f"legacy source resolution must quarantine a candidate: {repair_path}")

    if code in completed_records:
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
            raise SystemExit(f"quarantined source has a completed review record: {code}")

    required_checks = repair.get("requiredNextChecks")
    if not isinstance(required_checks, list) or not required_checks:
        raise SystemExit(f"requiredNextChecks missing: {repair_path}")

    return {
        "code": code,
        "mode": "quarantine",
        "quarantined": True,
        "resolutionStatus": repair.get("resolutionStatus"),
    }


def validate_corrected_official_source(
    repair: dict[str, Any],
    repair_path: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    code = company_code(repair, repair_path)

    candidate = repair.get("candidateMetadata")
    if not isinstance(candidate, dict):
        raise SystemExit(f"candidateMetadata missing: {repair_path}")
    if not isinstance(candidate.get("candidateTitle"), str) or not candidate.get("candidateTitle"):
        raise SystemExit(f"candidate title missing: {repair_path}")
    if not isinstance(candidate.get("candidatePublishedDate"), str) or not candidate.get("candidatePublishedDate"):
        raise SystemExit(f"candidate publication date missing: {repair_path}")

    resolved = repair.get("resolvedSource")
    if not isinstance(resolved, dict):
        raise SystemExit(f"resolvedSource missing: {repair_path}")
    for key in ("title", "publishedDate"):
        if not isinstance(resolved.get(key), str) or not resolved.get(key):
            raise SystemExit(f"resolvedSource.{key} missing: {repair_path}")
    validate_official_url(resolved.get("officialUrl"), str(repair_path))

    digest = resolved.get("pdfSha256")
    if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
        raise SystemExit(f"resolvedSource.pdfSha256 must be lowercase SHA-256: {repair_path}")
    page_count = resolved.get("pageCount")
    if not isinstance(page_count, int) or page_count <= 0:
        raise SystemExit(f"resolvedSource.pageCount must be positive: {repair_path}")

    decision = repair.get("decision")
    if not isinstance(decision, dict):
        raise SystemExit(f"decision missing: {repair_path}")
    if decision.get("status") != "candidate_metadata_corrected_to_newer_official_rolling_plan":
        raise SystemExit(f"unsupported corrected-source decision: {repair_path}")
    if decision.get("formalPlanConfirmed") is not True:
        raise SystemExit(f"formalPlanConfirmed must be true: {repair_path}")
    require_false(decision, "automaticApprovalAllowed", f"{repair_path}.decision")
    require_false(decision, "deepVerificationApproved", f"{repair_path}.decision")
    if not isinstance(decision.get("statement"), str) or not decision.get("statement"):
        raise SystemExit(f"decision.statement missing: {repair_path}")

    canonical = completed_records.get(code)
    if canonical is not None:
        expected = repair_path.as_posix()
        marker = "operations/quality-rebase/phase2/source-repairs/"
        if marker in expected:
            expected = expected[expected.index(marker):]
        if canonical.get("sourceResolutionFile") != expected:
            raise SystemExit(
                f"completed canonical record does not reference corrected source resolution: {code}"
            )
        if canonical.get("sourceCorrectionRequired") is not True:
            raise SystemExit(
                f"completed canonical record must retain sourceCorrectionRequired=true: {code}"
            )

    return {
        "code": code,
        "mode": "corrected_official_source",
        "quarantined": False,
        "resolutionStatus": decision.get("status"),
    }


def validate_repair(
    repair_path: Path,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    repair = load_json(repair_path)
    assert_no_automatic_approval(repair, str(repair_path))

    schema = repair.get("schemaVersion")
    if schema == LEGACY_SCHEMA:
        return validate_legacy_quarantine(
            repair,
            repair_path,
            repo_root,
            completed_records,
        )
    if schema == CORRECTED_SCHEMA:
        return validate_corrected_official_source(
            repair,
            repair_path,
            completed_records,
        )
    raise SystemExit(f"unexpected schemaVersion: {repair_path}: {schema}")


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
    assert_no_automatic_approval(status, "current-status")

    completed_records = canonical_completed_records(status)
    repair_dir = repo_root / "operations/quality-rebase/phase2/source-repairs"
    repair_paths = sorted(repair_dir.glob("*-source-resolution-v1.json"))
    if not repair_paths:
        raise SystemExit("no source-resolution records found")

    results = [
        validate_repair(path, repo_root, completed_records)
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
                "correctedOfficialSources": sum(
                    1 for result in results
                    if result["mode"] == "corrected_official_source"
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
