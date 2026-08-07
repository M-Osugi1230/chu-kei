#!/usr/bin/env python3
"""Phase 2 source-repair validator with primary-review supersession history.

v3 validates all current repair states plus formal-plan-search quarantines. This
layer adds one append-only historical transition: an old legacy quarantine can be
superseded by a later human primary review while independent review remains
blocked because the current official PDF binary hash is still not fixed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import validate_phase2_source_repairs_v2 as v2
import validate_phase2_source_repairs_v3 as v3

legacy = v2.legacy


def validate_primary_review_hash_pending(
    repair: dict[str, Any],
    repair_path: Path,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    legacy.assert_no_automatic_approval(repair, str(repair_path))
    code = legacy.company_code(repair, repair_path)
    canonical_record = completed_records.get(code)
    if canonical_record is None:
        raise SystemExit(f"hash-pending primary review not recorded canonically: {code}")
    if v2.load_completion(repo_root, code) is not None:
        raise SystemExit(f"hash-pending primary review already has independent completion: {code}")

    for key in (
        "primaryReviewComplete",
        "independentReviewReady",
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        # The historical repair itself predates the later primary review.
        legacy.require_false(repair, key, str(repair_path))

    incorrect = repair.get("incorrectCandidate")
    if not isinstance(incorrect, dict) or incorrect.get("mayEnterPrimaryReview") is not False:
        raise SystemExit(f"historical incorrectCandidate quarantine invalid: {code}")
    legacy.validate_pdf_identity(incorrect, f"{repair_path}.incorrectCandidate")

    current = repair.get("currentOfficialDocument")
    if not isinstance(current, dict):
        raise SystemExit(f"currentOfficialDocument missing: {code}")
    pdf_url = current.get("pdfUrl", current.get("officialUrl"))
    legacy.validate_https_url(pdf_url, f"{repair_path}.currentOfficialDocument.pdfUrl")
    page_count = current.get("pageCount")
    if not isinstance(page_count, int) or page_count <= 0:
        raise SystemExit(f"current official pageCount invalid: {code}")
    for key in (
        "identityConfirmed",
        "pageCountConfirmed",
        "publicationDateConfirmed",
        "planPeriodConfirmed",
    ):
        legacy.require_true(current, key, f"{repair_path}.currentOfficialDocument")
    if current.get("pdfSha256") is not None:
        raise SystemExit(f"historical hash-pending record unexpectedly has SHA-256: {code}")
    v2.require_string(
        current.get("binaryHashStatus"),
        f"{repair_path}.currentOfficialDocument.binaryHashStatus",
    )

    primary_path = repo_root / f"operations/quality-rebase/phase2/reviews/{code}-primary-review-v1.json"
    primary = legacy.load_json(primary_path)
    company = primary.get("company")
    if not isinstance(company, dict) or str(company.get("code", "")) != code:
        raise SystemExit(f"primary review company mismatch: {code}")
    source = primary.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"primary review source missing: {code}")
    if source.get("officialUrl") != pdf_url:
        raise SystemExit(f"primary review source URL mismatch: {code}")
    if source.get("pageCount") != page_count:
        raise SystemExit(f"primary review pageCount mismatch: {code}")
    if source.get("pdfSha256") is not None:
        raise SystemExit(f"primary review must remain hash-pending: {code}")
    v2.require_string(source.get("binaryHashStatus"), f"{primary_path}.source.binaryHashStatus")

    validation = primary.get("validation")
    if not isinstance(validation, dict):
        raise SystemExit(f"primary review validation missing: {code}")
    for key in (
        "companyIdentityConfirmed",
        "pageCountConfirmed",
        "formalPlanConfirmed",
        "formalPlanBoundaryValidated",
        "fullTextHumanReviewComplete",
        "visualFigureReviewComplete",
    ):
        legacy.require_true(validation, key, f"{primary_path}.validation")
    if validation.get("sourceBinaryHashConfirmed") is not False:
        raise SystemExit(f"primary review sourceBinaryHashConfirmed must be false: {code}")
    legacy.require_false(validation, "independentDoubleCheck", f"{primary_path}.validation")

    review = primary.get("review")
    if not isinstance(review, dict):
        raise SystemExit(f"primary review review section missing: {code}")
    status = str(review.get("status", ""))
    if not status.startswith("primary_review_complete"):
        raise SystemExit(f"later primary review is not complete: {code}")
    if review.get("independentReviewReady") is not False:
        raise SystemExit(f"hash-pending primary review cannot be independent-ready: {code}")
    v2.require_string(review.get("blockingReason"), f"{primary_path}.review.blockingReason")
    if review.get("automaticFactCompletionAllowed") is not False:
        raise SystemExit(f"automatic fact completion enabled in primary review: {code}")
    if review.get("automaticApprovalAllowed") is not False:
        raise SystemExit(f"automatic approval enabled in primary review: {code}")
    if review.get("deepVerificationApproved") is not False:
        raise SystemExit(f"deep verification enabled in primary review: {code}")

    required = repair.get("requiredNextChecks")
    if not isinstance(required, list) or not required:
        raise SystemExit(f"historical repair lacks requiredNextChecks: {code}")

    canonical_review_file = canonical_record.get("reviewFile")
    if canonical_review_file is not None and canonical_review_file != primary_path.relative_to(repo_root).as_posix():
        raise SystemExit(f"canonical primary review file mismatch: {code}")

    return {
        "code": code,
        "mode": "legacy_quarantine_superseded_by_primary_review_source_identity_pending",
        "quarantined": True,
        "resolutionStatus": repair.get("resolutionStatus"),
        "file": repair_path.name,
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
    status = legacy.load_json(repo_root / args.status)
    if status.get("automaticDeepApprovalAllowed") is not False:
        raise SystemExit("canonical status must prohibit automatic deep approval")
    legacy.assert_no_automatic_approval(status, "current-status")
    completed_records = legacy.canonical_completed_records(status)

    repair_dir = repo_root / "operations/quality-rebase/phase2/source-repairs"
    repair_paths = sorted(repair_dir.glob("*-source-resolution-v1.json"))
    if not repair_paths:
        raise SystemExit("no source-resolution records found")

    results: list[dict[str, Any]] = []
    for repair_path in repair_paths:
        repair = legacy.load_json(repair_path)
        schema = repair.get("schemaVersion")
        code = legacy.company_code(repair, repair_path)
        resolution = repair.get("resolution")
        is_formal_search_quarantine = (
            schema == legacy.CORRECTED_SCHEMA
            and isinstance(resolution, dict)
            and resolution.get("status") == v3.FORMAL_SEARCH_STATUS
            and resolution.get("waveEligibility") is False
        )
        has_completion = v2.load_completion(repo_root, code) is not None
        is_legacy_historical_quarantine_with_later_primary = (
            schema == legacy.LEGACY_SCHEMA
            and repair.get("primaryReviewComplete") is False
            and repair.get("independentReviewReady") is False
            and code in completed_records
            and not has_completion
        )

        if schema == v2.INDEPENDENT_SCHEMA:
            result = v2.validate_independent_resolution(repair, repair_path, repo_root)
        elif (
            schema == legacy.LEGACY_SCHEMA
            and repair.get("primaryReviewComplete") is True
            and repair.get("independentReviewReady") is False
        ):
            result = v2.validate_primary_complete_source_identity_pending(
                repair, repair_path, repo_root
            )
        elif schema == legacy.LEGACY_SCHEMA and repair.get("primaryReviewComplete") is True:
            result = legacy.validate_completed_legacy_resolution(
                repair, repair_path, repo_root, completed_records
            )
            result = {**result, "file": repair_path.name}
        elif is_legacy_historical_quarantine_with_later_primary:
            result = validate_primary_review_hash_pending(
                repair, repair_path, repo_root, completed_records
            )
        elif is_formal_search_quarantine:
            if has_completion:
                raise SystemExit(
                    "formal-plan-search quarantine has later completion; add explicit "
                    "supersession evidence before allowing it"
                )
            result = v3.validate_formal_plan_search_quarantine(
                repair, repair_path, completed_records
            )
        else:
            kind = v2.quarantine_kind(repair)
            if kind is not None and has_completion:
                result = v2.validate_superseded_quarantine(
                    repair, repair_path, repo_root, kind
                )
            else:
                result = legacy.validate_repair(
                    repair_path, repo_root, completed_records
                )
                result = {**result, "file": repair_path.name}
        results.append(result)

    print(
        json.dumps(
            {
                "status": "ok",
                "sourceResolutionRecords": len(results),
                "companiesRepresented": len({str(item["code"]) for item in results}),
                "quarantinedCompanies": len(
                    {str(item["code"]) for item in results if item["quarantined"]}
                ),
                "formalPlanSearchQuarantines": sum(
                    1 for item in results if item["mode"] == "formal_plan_search_quarantine"
                ),
                "independentSourceBlocked": sum(
                    1 for item in results if item["mode"] == "independent_source_blocked"
                ),
                "independentSourceResolved": sum(
                    1 for item in results if item["mode"] == "independent_source_resolved"
                ),
                "primaryReviewCompleteSourceIdentityPending": sum(
                    1
                    for item in results
                    if item["mode"] == "primary_review_complete_source_identity_pending"
                ),
                "historicalPrimaryReviewHashPending": sum(
                    1
                    for item in results
                    if item["mode"]
                    == "legacy_quarantine_superseded_by_primary_review_source_identity_pending"
                ),
                "historicalQuarantinesSuperseded": sum(
                    1
                    for item in results
                    if "superseded_by_independent_review" in item["mode"]
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
