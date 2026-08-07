#!/usr/bin/env python3
"""Source-repair validator for current official documents awaiting hash/full review.

v6 handles completed, superseded, independent, and hash-pending primary-review
states. This layer adds the strict quarantine used when the correct current
official formal-plan PDF has been identified and key boundaries located, but the
repository still lacks a fixed SHA-256 and full human review. Such records remain
ineligible for primary/independent completion.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import validate_phase2_source_repairs_v6 as v6

legacy = v6.legacy
_original_validate_repair = legacy.validate_repair

PENDING_STATUS = "current_official_pdf_identity_confirmed_binary_hash_and_full_review_pending"


def require_true(obj: dict[str, Any], key: str, location: str) -> None:
    legacy.require_true(obj, key, location)


def validate_current_official_hash_and_review_pending(
    repair: dict[str, Any], repair_path: Path, repo_root: Path
) -> dict[str, Any]:
    legacy.assert_no_automatic_approval(repair, str(repair_path))
    code = legacy.company_code(repair, repair_path)
    if repair.get("resolutionStatus") != PENDING_STATUS:
        raise SystemExit(f"unexpected pending resolution status: {code}")
    for key in (
        "primaryReviewComplete",
        "independentReviewReady",
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        legacy.require_false(repair, key, str(repair_path))

    if v6.v5.v2.load_completion(repo_root, code) is not None:
        raise SystemExit(f"hash/full-review pending company already has completion: {code}")

    incorrect = repair.get("incorrectCandidate")
    if not isinstance(incorrect, dict):
        raise SystemExit(f"incorrectCandidate missing: {code}")
    old_url = incorrect.get("pdfUrl", incorrect.get("url"))
    legacy.validate_https_url(old_url, f"{repair_path}.incorrectCandidate.url")
    digest = incorrect.get("pdfSha256")
    if not isinstance(digest, str) or not legacy.SHA256_PATTERN.fullmatch(digest):
        raise SystemExit(f"incorrectCandidate SHA-256 invalid: {code}")
    page_count = incorrect.get("pageCount")
    if not isinstance(page_count, int) or page_count <= 0:
        raise SystemExit(f"incorrectCandidate pageCount invalid: {code}")
    if incorrect.get("mayEnterPrimaryReview") is not False:
        raise SystemExit(f"incorrectCandidate mayEnterPrimaryReview must be false: {code}")

    current = repair.get("currentOfficialDocument")
    if not isinstance(current, dict):
        raise SystemExit(f"currentOfficialDocument missing: {code}")
    current_url = current.get("pdfUrl", current.get("officialUrl"))
    legacy.validate_https_url(current_url, f"{repair_path}.currentOfficialDocument.pdfUrl")
    current_pages = current.get("pageCount")
    if not isinstance(current_pages, int) or current_pages <= 0:
        raise SystemExit(f"currentOfficialDocument pageCount invalid: {code}")
    if current.get("pdfSha256") is not None:
        raise SystemExit(f"pending current official document unexpectedly has SHA-256: {code}")
    binary_status = current.get("binaryHashStatus")
    if not isinstance(binary_status, str) or not binary_status.strip():
        raise SystemExit(f"pending current official document lacks binaryHashStatus: {code}")
    for key in (
        "identityConfirmed",
        "pageCountConfirmed",
        "publicationDateConfirmed",
        "planPeriodConfirmed",
    ):
        require_true(current, key, f"{repair_path}.currentOfficialDocument")

    validation = repair.get("validation")
    if not isinstance(validation, dict):
        raise SystemExit(f"validation section missing: {code}")
    for key in (
        "currentOfficialPdfUrlConfirmed",
        "companyIdentityConfirmed",
        "securityCodeConfirmed",
        "publicationDateConfirmed",
        "pageCountConfirmed",
        "formalPlanBoundaryConfirmed",
        "previousAndCurrentPlanSeparated",
        "longTermVisionSeparatedFromCurrentPlan",
        "keyFinancialTargetLocated",
        "capitalPolicyLocated",
        "shareholderReturnPolicyLocated",
    ):
        require_true(validation, key, f"{repair_path}.validation")
    legacy.require_false(validation, "pdfSha256Confirmed", f"{repair_path}.validation")
    legacy.require_false(
        validation, "fullTextRepositoryReviewComplete", f"{repair_path}.validation"
    )
    legacy.require_false(validation, "independentDoubleCheck", f"{repair_path}.validation")

    facts = repair.get("confirmedCurrentPlanFacts")
    if not isinstance(facts, dict) or not facts:
        raise SystemExit(f"confirmedCurrentPlanFacts missing: {code}")
    boundary = repair.get("formalPlanBoundary")
    if not isinstance(boundary, dict) or not boundary:
        raise SystemExit(f"formalPlanBoundary missing: {code}")
    required = repair.get("requiredNextChecks")
    if not isinstance(required, list) or not required:
        raise SystemExit(f"requiredNextChecks missing: {code}")

    return {
        "code": code,
        "mode": "current_official_hash_and_full_review_pending",
        "quarantined": True,
        "resolutionStatus": PENDING_STATUS,
        "file": repair_path.name,
    }


def validate_repair_dispatch(
    repair_path: Path,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    repair = legacy.load_json(repair_path)
    if (
        repair.get("schemaVersion") == legacy.CORRECTED_SCHEMA
        and repair.get("resolutionStatus") == PENDING_STATUS
        and repair.get("primaryReviewComplete") is False
        and repair.get("independentReviewReady") is False
    ):
        return validate_current_official_hash_and_review_pending(
            repair, repair_path, repo_root
        )
    return _original_validate_repair(repair_path, repo_root, completed_records)


legacy.validate_repair = validate_repair_dispatch

if __name__ == "__main__":
    v6.v5.main()
