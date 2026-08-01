#!/usr/bin/env python3
"""Validate a Phase 2 primary-review wave without granting approval.

This validator intentionally checks only queue integrity and governance.
It never infers factual completion and never changes review or approval state.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

REQUIRED_COMPANY_FIELDS = {
    "order",
    "code",
    "name",
    "documentTypeCandidate",
    "relevanceScore",
    "pageCount",
    "reviewInput",
    "status",
    "requiredChecks",
}

FORBIDDEN_TRUE_KEYS = {
    "automaticFactCompletionAllowed",
    "automaticApprovalAllowed",
    "deepVerificationApproved",
}

ALREADY_COMPLETED_CODES = {"4061", "8113"}
ALLOWED_DOCUMENT_TYPES = {
    "formal_management_plan",
    "plan_revision_or_update",
    "growth_potential_document",
}


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"top-level value must be an object: {path}")
    return value


def assert_no_forbidden_true(value: Any, location: str = "root") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            child_location = f"{location}.{key}"
            if key in FORBIDDEN_TRUE_KEYS and child is True:
                raise SystemExit(f"forbidden approval/completion flag at {child_location}")
            assert_no_forbidden_true(child, child_location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_true(child, f"{location}[{index}]")


def validate_wave(wave: dict[str, Any], repo_root: Path) -> None:
    if wave.get("schemaVersion") != "phase2-primary-review-wave-v1":
        raise SystemExit("unexpected schemaVersion")

    companies = wave.get("companies")
    if not isinstance(companies, list):
        raise SystemExit("companies must be an array")

    target = wave.get("targetCompanies")
    if not isinstance(target, int) or target <= 0:
        raise SystemExit("targetCompanies must be a positive integer")
    if len(companies) != target:
        raise SystemExit(
            f"company count mismatch: targetCompanies={target}, actual={len(companies)}"
        )

    codes: list[str] = []
    orders: list[int] = []
    for index, company in enumerate(companies):
        if not isinstance(company, dict):
            raise SystemExit(f"companies[{index}] must be an object")

        missing = REQUIRED_COMPANY_FIELDS - company.keys()
        if missing:
            raise SystemExit(
                f"companies[{index}] missing fields: {', '.join(sorted(missing))}"
            )

        code = str(company["code"])
        codes.append(code)
        if code in ALREADY_COMPLETED_CODES:
            raise SystemExit(f"already completed company was reassigned: {code}")

        order = company["order"]
        if not isinstance(order, int) or order < 51:
            raise SystemExit(f"invalid Phase 2 order for {code}: {order}")
        orders.append(order)

        document_type = company["documentTypeCandidate"]
        if document_type not in ALLOWED_DOCUMENT_TYPES:
            raise SystemExit(
                f"unsupported documentTypeCandidate for {code}: {document_type}"
            )

        score = company["relevanceScore"]
        if not isinstance(score, int) or score <= 0:
            raise SystemExit(f"invalid relevanceScore for {code}: {score}")

        page_count = company["pageCount"]
        if not isinstance(page_count, int) or page_count <= 0:
            raise SystemExit(f"invalid pageCount for {code}: {page_count}")

        checks = company["requiredChecks"]
        if not isinstance(checks, list) or len(checks) < 4:
            raise SystemExit(f"insufficient requiredChecks for {code}")
        if "fieldLevelEvidence" not in checks:
            raise SystemExit(f"fieldLevelEvidence check missing for {code}")

        review_input = repo_root / str(company["reviewInput"])
        if not review_input.is_file():
            raise SystemExit(f"review input does not exist for {code}: {review_input}")

        status = str(company["status"])
        if "complete" in status or "approved" in status:
            raise SystemExit(f"premature completion/approval status for {code}: {status}")

    if len(set(codes)) != len(codes):
        raise SystemExit("duplicate company codes in wave")
    if len(set(orders)) != len(orders):
        raise SystemExit("duplicate company orders in wave")

    counts = wave.get("counts")
    if not isinstance(counts, dict):
        raise SystemExit("counts must be an object")
    if counts.get("assigned") != len(companies):
        raise SystemExit("counts.assigned does not match company count")
    if counts.get("primaryReviewComplete") != 0:
        raise SystemExit("primaryReviewComplete must remain zero at assignment time")
    if counts.get("independentReviewReady") != 0:
        raise SystemExit("independentReviewReady must remain zero at assignment time")
    if counts.get("deepVerificationApproved") != 0:
        raise SystemExit("deepVerificationApproved must remain zero")

    assert_no_forbidden_true(wave)


def validate_status(status: dict[str, Any], wave: dict[str, Any]) -> None:
    if status.get("automaticDeepApprovalAllowed") is not False:
        raise SystemExit("current status must explicitly prohibit automatic deep approval")

    collection = status.get("collection", {})
    relevance = status.get("sourceRelevanceAudit", {})
    review = status.get("review", {})

    if collection.get("companiesCollected") != 450:
        raise SystemExit("collection.companiesCollected must be 450")
    if collection.get("uniqueCompaniesCollected") != 450:
        raise SystemExit("collection.uniqueCompaniesCollected must be 450")
    if relevance.get("auditedCompanies") != 450:
        raise SystemExit("sourceRelevanceAudit.auditedCompanies must be 450")

    classified = sum(
        int(relevance.get(key, 0))
        for key in (
            "primaryReviewCandidates",
            "humanRelevanceReviewRequired",
            "likelyWrongDocument",
            "pdfIdentificationRequired",
            "sourceRecoveryRequired",
        )
    )
    if classified != 450:
        raise SystemExit(f"source relevance classification total must be 450, got {classified}")

    if review.get("primaryReviewWaveAssigned") != wave.get("targetCompanies"):
        raise SystemExit("status assigned count does not match wave target")
    if review.get("primaryReviewComplete") != 2:
        raise SystemExit("only the two actually completed Phase 2 reviews may be counted")
    if review.get("deepVerificationApproved") != 0:
        raise SystemExit("review.deepVerificationApproved must remain zero")

    assert_no_forbidden_true(status)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--wave",
        default="operations/quality-rebase/phase2/primary-review-wave01-v1.json",
        help="Path to the primary-review wave JSON",
    )
    parser.add_argument(
        "--status",
        default="operations/quality-rebase/phase2/current-status-v1.json",
        help="Path to the Phase 2 current-status JSON",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root used to resolve reviewInput paths",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    wave = load_json(repo_root / args.wave)
    status = load_json(repo_root / args.status)

    validate_wave(wave, repo_root)
    validate_status(status, wave)

    print(
        json.dumps(
            {
                "status": "ok",
                "wave": wave["wave"],
                "assignedCompanies": len(wave["companies"]),
                "sourceRelevanceAudited": status["sourceRelevanceAudit"]["auditedCompanies"],
                "primaryReviewComplete": status["review"]["primaryReviewComplete"],
                "deepVerificationApproved": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
