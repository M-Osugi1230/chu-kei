#!/usr/bin/env python3
"""Validate Phase 2 source-repair and source-resolution safety.

Supported source-resolution states:

1. A wrong or unresolved candidate is quarantined and must not enter primary
   review.
2. Candidate metadata is corrected to a newer official formal-plan document.
3. A formal-plan boundary or document identity is resolved and the primary
   review is already complete. This is accepted only when the canonical ledger,
   review file, evidence flags, and pending independent-review state agree.

This validator never approves a review, infers a fact, or converts a pending
record into a completed one.
"""

from __future__ import annotations

import argparse
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


def require_true(value: dict[str, Any], key: str, location: str) -> None:
    if value.get(key) is not True:
        raise SystemExit(f"{location}.{key} must be true")


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


def repository_relative(path: Path) -> str:
    normalized = path.as_posix()
    marker = "operations/quality-rebase/phase2/"
    if marker not in normalized:
        raise SystemExit(f"path is outside Phase 2 repository area: {path}")
    return marker + normalized.split(marker, 1)[1]


def validate_https_url(value: Any, location: str) -> None:
    if not isinstance(value, str) or not value:
        raise SystemExit(f"URL missing: {location}")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise SystemExit(f"URL must be an absolute HTTPS URL: {location}")


def validate_pdf_identity(document: dict[str, Any], location: str) -> None:
    pdf_url = document.get("pdfUrl", document.get("officialUrl"))
    validate_https_url(pdf_url, f"{location}.pdfUrl")

    digest = document.get("pdfSha256")
    if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
        raise SystemExit(f"{location}.pdfSha256 must be lowercase SHA-256")

    page_count = document.get("pageCount")
    if not isinstance(page_count, int) or page_count <= 0:
        raise SystemExit(f"{location}.pageCount must be positive")


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
        raise SystemExit(f"quarantine record must prohibit primary review: {repair_path}")

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


def validate_completed_legacy_resolution(
    repair: dict[str, Any],
    repair_path: Path,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    code = company_code(repair, repair_path)

    require_true(repair, "primaryReviewComplete", str(repair_path))
    require_true(repair, "independentReviewReady", str(repair_path))
    for key in (
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        require_false(repair, key, str(repair_path))

    canonical = completed_records.get(code)
    if canonical is None:
        raise SystemExit(
            f"completed source resolution is absent from canonical ledger: {code}"
        )

    primary_review_file = repair.get("primaryReviewFile")
    if not isinstance(primary_review_file, str) or not primary_review_file:
        raise SystemExit(f"primaryReviewFile missing: {repair_path}")
    if canonical.get("reviewFile") != primary_review_file:
        raise SystemExit(f"canonical reviewFile mismatch for resolved source: {code}")

    review_path = repo_root / primary_review_file
    review = load_json(review_path)
    review_company = review.get("company")
    if not isinstance(review_company, dict) or str(review_company.get("code")) != code:
        raise SystemExit(f"primary review company mismatch: {code}")
    review_state = review.get("review")
    if not isinstance(review_state, dict) or not str(
        review_state.get("status", "")
    ).startswith("primary_review_complete"):
        raise SystemExit(f"primary review is not complete for resolved source: {code}")

    document = repair.get("currentOfficialDocument")
    if not isinstance(document, dict):
        raise SystemExit(f"currentOfficialDocument missing: {repair_path}")
    validate_pdf_identity(document, f"{repair_path}.currentOfficialDocument")
    for key in (
        "identityConfirmed",
        "pageCountConfirmed",
        "publicationDateConfirmed",
        "binaryHashConfirmed",
    ):
        require_true(document, key, f"{repair_path}.currentOfficialDocument")

    classification = repair.get("documentClassification")
    if not isinstance(classification, str) or not classification:
        raise SystemExit(f"documentClassification missing: {repair_path}")
    canonical_classification = canonical.get("sourceClassification")
    if canonical_classification and canonical_classification != classification:
        raise SystemExit(f"canonical source classification mismatch for {code}")

    boundary = repair.get("formalPlanBoundary")
    if not isinstance(boundary, dict) or not isinstance(boundary.get("statement"), str):
        raise SystemExit(f"formalPlanBoundary evidence missing: {repair_path}")

    validation = repair.get("validation")
    if not isinstance(validation, dict):
        raise SystemExit(f"validation section missing: {repair_path}")
    for key in (
        "companyIdentityConfirmed",
        "publicationDateConfirmed",
        "pageCountConfirmed",
        "pdfSha256Confirmed",
        "formalPlanBoundaryConfirmed",
        "fullTextRepositoryReviewComplete",
        "visualFigureReviewComplete",
    ):
        require_true(validation, key, f"{repair_path}.validation")
    require_false(validation, "independentDoubleCheck", f"{repair_path}.validation")

    return {
        "code": code,
        "mode": "completed_formal_plan_resolution",
        "quarantined": False,
        "resolutionStatus": repair.get("resolutionStatus"),
    }


def validate_legacy_resolution(
    repair: dict[str, Any],
    repair_path: Path,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    incorrect = repair.get("incorrectCandidate")
    if isinstance(incorrect, dict) and incorrect.get("mayEnterPrimaryReview") is False:
        return validate_legacy_quarantine(
            repair, repair_path, repo_root, completed_records
        )

    if repair.get("primaryReviewComplete") is True:
        return validate_completed_legacy_resolution(
            repair, repair_path, repo_root, completed_records
        )

    raise SystemExit(
        f"legacy source resolution is neither quarantined nor completed: {repair_path}"
    )


def validate_corrected_official_source(
    repair: dict[str, Any],
    repair_path: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    code = company_code(repair, repair_path)

    candidate = repair.get("candidateMetadata")
    if not isinstance(candidate, dict):
        raise SystemExit(f"candidateMetadata missing: {repair_path}")
    if not isinstance(candidate.get("candidateTitle"), str) or not candidate.get(
        "candidateTitle"
    ):
        raise SystemExit(f"candidate title missing: {repair_path}")
    if not isinstance(candidate.get("candidatePublishedDate"), str) or not candidate.get(
        "candidatePublishedDate"
    ):
        raise SystemExit(f"candidate publication date missing: {repair_path}")

    resolved = repair.get("resolvedSource")
    if not isinstance(resolved, dict):
        raise SystemExit(f"resolvedSource missing: {repair_path}")
    for key in ("title", "publishedDate"):
        if not isinstance(resolved.get(key), str) or not resolved.get(key):
            raise SystemExit(f"resolvedSource.{key} missing: {repair_path}")
    validate_pdf_identity(resolved, f"{repair_path}.resolvedSource")

    decision = repair.get("decision")
    if not isinstance(decision, dict):
        raise SystemExit(f"decision missing: {repair_path}")
    if decision.get("status") != "candidate_metadata_corrected_to_newer_official_rolling_plan":
        raise SystemExit(f"unsupported corrected-source decision: {repair_path}")
    require_true(decision, "formalPlanConfirmed", f"{repair_path}.decision")
    require_false(decision, "automaticApprovalAllowed", f"{repair_path}.decision")
    require_false(decision, "deepVerificationApproved", f"{repair_path}.decision")
    if not isinstance(decision.get("statement"), str) or not decision.get("statement"):
        raise SystemExit(f"decision.statement missing: {repair_path}")

    canonical = completed_records.get(code)
    if canonical is not None:
        expected = repository_relative(repair_path)
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
        return validate_legacy_resolution(
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
                    1
                    for result in results
                    if result["mode"] == "corrected_official_source"
                ),
                "completedFormalPlanResolutions": sum(
                    1
                    for result in results
                    if result["mode"] == "completed_formal_plan_resolution"
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
