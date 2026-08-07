#!/usr/bin/env python3
"""Validate Phase 2 source-repair history without weakening legacy rules.

This wrapper keeps the original source-repair validator authoritative for its
legacy/corrected schemas and adds explicit handling for two append-only states
that now exist in the repository:

* independent-review source resolutions;
* a primary review completed by a human while source binary identity is still
  pending, so independent review remains blocked.

Historical quarantines may coexist with a later human-reviewed completion only
when the later completion proves canonical collection identity and passes all
review-safety checks. The old quarantine remains audit history.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import validate_phase2_source_repairs as legacy

INDEPENDENT_SCHEMA = "quality-rebase-phase2-independent-source-resolution-v1"
INDEPENDENT_COMPLETION_SCHEMA = "quality-rebase-phase2-independent-completion-v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def require_string(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"missing string: {location}")
    return value.strip()


def load_completion(repo_root: Path, code: str) -> tuple[Path, dict[str, Any]] | None:
    path = (
        repo_root
        / "operations/quality-rebase/phase2/independent-completions"
        / f"{code}-independent-completion-v1.json"
    )
    if not path.exists():
        return None
    completion = legacy.load_json(path)
    if completion.get("schemaVersion") != INDEPENDENT_COMPLETION_SCHEMA:
        raise SystemExit(f"unexpected independent completion schema: {path}")
    company = completion.get("company")
    if not isinstance(company, dict) or str(company.get("code", "")) != code:
        raise SystemExit(f"independent completion company mismatch: {code}")
    if completion.get("status") != "independent_review_complete":
        raise SystemExit(f"independent completion is not complete: {code}")
    return path, completion


def validate_completion_safety(completion: dict[str, Any], code: str) -> None:
    legacy.assert_no_automatic_approval(completion, f"independentCompletion[{code}]")
    review = completion.get("review")
    if not isinstance(review, dict):
        raise SystemExit(f"independent completion review section missing: {code}")
    if review.get("automaticApprovalAllowed") is not False:
        raise SystemExit(f"independent completion automatic approval must be false: {code}")
    if review.get("deepVerificationApproved") is not False:
        raise SystemExit(f"independent completion deep verification must be false: {code}")
    checks = completion.get("checks")
    if not isinstance(checks, list) or not checks:
        raise SystemExit(f"independent completion checks missing: {code}")
    for check in checks:
        if not isinstance(check, dict) or check.get("status") != "confirmed":
            raise SystemExit(f"independent completion contains unconfirmed check: {code}")
    blockers = completion.get("finalDeepVerificationBlockers")
    if blockers is not None and not isinstance(blockers, list):
        raise SystemExit(f"finalDeepVerificationBlockers must be an array: {code}")


def validate_collection_integrity(
    completion: dict[str, Any], repo_root: Path, code: str
) -> None:
    cross = completion.get("crossChecks")
    if not isinstance(cross, dict):
        raise SystemExit(f"crossChecks missing for completion: {code}")
    integrity = cross.get("collectionIntegrity")
    if not isinstance(integrity, dict):
        raise SystemExit(f"collectionIntegrity missing for completion: {code}")
    collection_file = require_string(
        integrity.get("file"), f"completion[{code}].collectionIntegrity.file"
    )
    for key in ("sourceUrlMatched", "pdfSha256Matched", "pageCountMatched"):
        if integrity.get(key) is not True:
            raise SystemExit(f"completion[{code}].collectionIntegrity.{key} must be true")

    collection = legacy.load_json(repo_root / collection_file)
    company = collection.get("company")
    if not isinstance(company, dict) or str(company.get("code", "")) != code:
        raise SystemExit(f"collection company mismatch for completion: {code}")

    source = completion.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"completion source missing: {code}")
    expected_url = collection.get("resolvedPdfUrl") or collection.get("sourceUrl")
    if source.get("officialUrl") != expected_url:
        raise SystemExit(f"completion source URL does not match collection: {code}")
    if source.get("pdfSha256") != collection.get("pdfSha256"):
        raise SystemExit(f"completion SHA-256 does not match collection: {code}")
    if source.get("pageCount") != collection.get("pageCount"):
        raise SystemExit(f"completion page count does not match collection: {code}")

    primary_path = require_string(
        completion.get("primaryReviewFile"), f"completion[{code}].primaryReviewFile"
    )
    primary = legacy.load_json(repo_root / primary_path)
    primary_company = primary.get("company")
    if not isinstance(primary_company, dict) or str(primary_company.get("code", "")) != code:
        raise SystemExit(f"primary review company mismatch for completion: {code}")
    review = primary.get("review")
    status = str(review.get("status", "")) if isinstance(review, dict) else ""
    if not status.startswith("primary_review_complete"):
        raise SystemExit(f"primary review is not complete for completion: {code}")


def validate_independent_completion(
    repair: dict[str, Any], repair_path: Path, repo_root: Path, code: str
) -> None:
    loaded = load_completion(repo_root, code)
    if loaded is None:
        raise SystemExit(f"resolved source lacks independent completion: {code}")
    _, completion = loaded
    validate_completion_safety(completion, code)

    canonical = repair.get("canonicalSource")
    source = completion.get("source")
    if not isinstance(canonical, dict) or not isinstance(source, dict):
        raise SystemExit(f"resolved source metadata missing for {code}")
    legacy.validate_pdf_identity(canonical, f"{repair_path}.canonicalSource")
    for key in ("officialUrl", "pdfSha256", "pageCount"):
        if source.get(key) != canonical.get(key):
            raise SystemExit(f"completion/canonical source mismatch for {code}: {key}")
    validate_collection_integrity(completion, repo_root, code)

    correction_file = repair.get("evidenceCorrectionFile")
    if correction_file is not None:
        correction_path = repo_root / require_string(
            correction_file, f"{repair_path}.evidenceCorrectionFile"
        )
        correction = legacy.load_json(correction_path)
        company = correction.get("company")
        if not isinstance(company, dict) or str(company.get("code", "")) != code:
            raise SystemExit(f"evidence correction company mismatch: {code}")
        legacy.assert_no_automatic_approval(correction, str(correction_path))


def validate_independent_resolution(
    repair: dict[str, Any], repair_path: Path, repo_root: Path
) -> dict[str, Any]:
    legacy.assert_no_automatic_approval(repair, str(repair_path))
    code = legacy.company_code(repair, repair_path)
    require_string(repair.get("resolutionStatus"), f"{repair_path}.resolutionStatus")
    for key in (
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        legacy.require_false(repair, key, str(repair_path))

    blocked = repair.get("independentReviewCompletionBlocked")
    if not isinstance(blocked, bool):
        raise SystemExit(f"independentReviewCompletionBlocked must be boolean: {repair_path}")

    completion = load_completion(repo_root, code)
    if blocked:
        checks = repair.get("requiredNextChecks")
        if not isinstance(checks, list) or not checks:
            raise SystemExit(f"blocked source resolution lacks requiredNextChecks: {code}")
        if completion is not None:
            raise SystemExit(f"blocked source already has independent completion: {code}")
        return {
            "code": code,
            "mode": "independent_source_blocked",
            "quarantined": True,
            "resolutionStatus": repair.get("resolutionStatus"),
            "file": repair_path.name,
        }

    require_string(repair.get("resolvedAt"), f"{repair_path}.resolvedAt")
    canonical = repair.get("canonicalSource")
    if not isinstance(canonical, dict):
        raise SystemExit(f"resolved record lacks canonicalSource: {code}")
    legacy.validate_pdf_identity(canonical, f"{repair_path}.canonicalSource")
    validate_independent_completion(repair, repair_path, repo_root, code)
    return {
        "code": code,
        "mode": "independent_source_resolved",
        "quarantined": False,
        "resolutionStatus": repair.get("resolutionStatus"),
        "file": repair_path.name,
    }


def validate_primary_complete_source_identity_pending(
    repair: dict[str, Any], repair_path: Path, repo_root: Path
) -> dict[str, Any]:
    """Validate a human-complete primary review still blocked on source identity."""
    legacy.assert_no_automatic_approval(repair, str(repair_path))
    code = legacy.company_code(repair, repair_path)
    legacy.require_true(repair, "primaryReviewComplete", str(repair_path))
    legacy.require_false(repair, "independentReviewReady", str(repair_path))
    for key in (
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        legacy.require_false(repair, key, str(repair_path))
    if load_completion(repo_root, code) is not None:
        raise SystemExit(f"source-identity-pending company already has completion: {code}")

    document = repair.get("currentOfficialDocument")
    if not isinstance(document, dict):
        raise SystemExit(f"currentOfficialDocument missing: {repair_path}")
    pdf_url = document.get("pdfUrl", document.get("officialUrl"))
    legacy.validate_https_url(pdf_url, f"{repair_path}.currentOfficialDocument.pdfUrl")
    page_count = document.get("pageCount")
    if not isinstance(page_count, int) or page_count <= 0:
        raise SystemExit(f"currentOfficialDocument.pageCount invalid: {code}")
    for key in (
        "identityConfirmed",
        "pageCountConfirmed",
        "publicationDateConfirmed",
        "planPeriodConfirmed",
    ):
        legacy.require_true(document, key, f"{repair_path}.currentOfficialDocument")
    digest = document.get("pdfSha256")
    if digest is not None and not (
        isinstance(digest, str) and SHA256_PATTERN.fullmatch(digest)
    ):
        raise SystemExit(f"invalid pending source SHA-256 field: {code}")
    if digest is None:
        require_string(
            document.get("binaryHashStatus"),
            f"{repair_path}.currentOfficialDocument.binaryHashStatus",
        )

    validation = repair.get("validation")
    if not isinstance(validation, dict):
        raise SystemExit(f"validation section missing: {repair_path}")
    for key in (
        "companyIdentityConfirmed",
        "publicationDateConfirmed",
        "pageCountConfirmed",
        "formalPlanBoundaryConfirmed",
        "fullTextRepositoryReviewComplete",
        "visualFigureReviewComplete",
    ):
        legacy.require_true(validation, key, f"{repair_path}.validation")
    if validation.get("pdfSha256Confirmed") is not False:
        raise SystemExit(f"pending identity must keep pdfSha256Confirmed=false: {code}")
    legacy.require_false(validation, "independentDoubleCheck", f"{repair_path}.validation")

    primary_file = require_string(
        repair.get("primaryReviewFile"), f"{repair_path}.primaryReviewFile"
    )
    primary = legacy.load_json(repo_root / primary_file)
    company = primary.get("company")
    if not isinstance(company, dict) or str(company.get("code", "")) != code:
        raise SystemExit(f"primary review company mismatch: {code}")
    primary_review = primary.get("review")
    primary_status = (
        str(primary_review.get("status", "")) if isinstance(primary_review, dict) else ""
    )
    if not primary_status.startswith("primary_review_complete"):
        raise SystemExit(f"primary review is not complete: {code}")

    required = repair.get("requiredNextChecks")
    if not isinstance(required, list) or not required:
        raise SystemExit(f"source-identity-pending record lacks requiredNextChecks: {code}")
    require_string(
        repair.get("independentReviewBlockingReason"),
        f"{repair_path}.independentReviewBlockingReason",
    )

    return {
        "code": code,
        "mode": "primary_review_complete_source_identity_pending",
        "quarantined": True,
        "resolutionStatus": repair.get("resolutionStatus"),
        "file": repair_path.name,
    }


def quarantine_kind(repair: dict[str, Any]) -> str | None:
    schema = repair.get("schemaVersion")
    if schema == legacy.LEGACY_SCHEMA:
        if repair.get("primaryReviewComplete") is True:
            return None
        incorrect = repair.get("incorrectCandidate")
        if isinstance(incorrect, dict) and incorrect.get("mayEnterPrimaryReview") is False:
            return "legacy_quarantine"
    if schema == legacy.CORRECTED_SCHEMA:
        resolution = repair.get("resolution")
        if (
            isinstance(resolution, dict)
            and resolution.get("status")
            == "source_isolated_quantified_plan_republication_required"
            and resolution.get("waveEligibility") is False
        ):
            return "quantified_plan_quarantine"
    return None


def validate_superseded_quarantine(
    repair: dict[str, Any], repair_path: Path, repo_root: Path, kind: str
) -> dict[str, Any]:
    code = legacy.company_code(repair, repair_path)
    loaded = load_completion(repo_root, code)
    if loaded is None:
        raise SystemExit(f"superseded quarantine lacks completion: {code}")
    _, completion = loaded
    validate_completion_safety(completion, code)
    validate_collection_integrity(completion, repo_root, code)
    legacy.assert_no_automatic_approval(repair, str(repair_path))

    if kind == "legacy_quarantine":
        for key in (
            "primaryReviewComplete",
            "independentReviewReady",
            "automaticFactCompletionAllowed",
            "automaticApprovalAllowed",
            "deepVerificationApproved",
        ):
            legacy.require_false(repair, key, str(repair_path))
        incorrect = repair.get("incorrectCandidate")
        if not isinstance(incorrect, dict) or incorrect.get("mayEnterPrimaryReview") is not False:
            raise SystemExit(f"historical quarantine structure invalid: {code}")
        checks = repair.get("requiredNextChecks")
        if not isinstance(checks, list) or not checks:
            raise SystemExit(f"historical quarantine lacks requiredNextChecks: {code}")
    else:
        candidate = repair.get("candidate")
        if not isinstance(candidate, dict):
            raise SystemExit(f"historical quantified quarantine lacks candidate: {code}")
        legacy.validate_pdf_identity(candidate, f"{repair_path}.candidate")
        finding = repair.get("finding")
        if not isinstance(finding, dict):
            raise SystemExit(f"historical quantified quarantine lacks finding: {code}")
        if finding.get("type") != "quantified_formal_plan_boundary_not_met":
            raise SystemExit(f"historical quantified quarantine finding invalid: {code}")
        legacy.require_true(finding, "sourceIdentityConfirmed", f"{repair_path}.finding")
        legacy.require_true(finding, "managementRoadmapConfirmed", f"{repair_path}.finding")
        legacy.require_false(
            finding,
            "quantifiedMediumTermTargetsConfirmed",
            f"{repair_path}.finding",
        )
        evidence = finding.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise SystemExit(f"historical quantified quarantine lacks evidence: {code}")
        resolution = repair.get("resolution")
        if not isinstance(resolution, dict):
            raise SystemExit(f"historical quantified quarantine lacks resolution: {code}")
        if resolution.get("status") != "source_isolated_quantified_plan_republication_required":
            raise SystemExit(f"historical quantified quarantine resolution invalid: {code}")
        legacy.require_false(resolution, "waveEligibility", f"{repair_path}.resolution")
        legacy.require_true(resolution, "replacementRequired", f"{repair_path}.resolution")
        next_actions = resolution.get("nextActions")
        if not isinstance(next_actions, list) or not next_actions:
            raise SystemExit(f"historical quantified quarantine lacks nextActions: {code}")
        approval = repair.get("approval")
        if not isinstance(approval, dict):
            raise SystemExit(f"historical quantified quarantine lacks approval: {code}")
        legacy.require_false(approval, "automaticApprovalAllowed", f"{repair_path}.approval")
        legacy.require_false(approval, "deepVerificationApproved", f"{repair_path}.approval")

    return {
        "code": code,
        "mode": f"{kind}_superseded_by_independent_review",
        "quarantined": False,
        "resolutionStatus": "historical_quarantine_superseded",
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
        if schema == INDEPENDENT_SCHEMA:
            result = validate_independent_resolution(repair, repair_path, repo_root)
        elif (
            schema == legacy.LEGACY_SCHEMA
            and repair.get("primaryReviewComplete") is True
            and repair.get("independentReviewReady") is False
        ):
            result = validate_primary_complete_source_identity_pending(
                repair, repair_path, repo_root
            )
        elif schema == legacy.LEGACY_SCHEMA and repair.get("primaryReviewComplete") is True:
            # Bypass the legacy function's older quarantine-first dispatch and
            # validate the current completed state directly.
            result = legacy.validate_completed_legacy_resolution(
                repair, repair_path, repo_root, completed_records
            )
            result = {**result, "file": repair_path.name}
        else:
            kind = quarantine_kind(repair)
            code = legacy.company_code(repair, repair_path)
            if kind is not None and load_completion(repo_root, code) is not None:
                result = validate_superseded_quarantine(
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
                "companiesRepresented": len({str(result["code"]) for result in results}),
                "quarantinedCompanies": len(
                    {str(result["code"]) for result in results if result["quarantined"]}
                ),
                "independentSourceBlocked": sum(
                    1 for result in results if result["mode"] == "independent_source_blocked"
                ),
                "independentSourceResolved": sum(
                    1 for result in results if result["mode"] == "independent_source_resolved"
                ),
                "primaryReviewCompleteSourceIdentityPending": sum(
                    1
                    for result in results
                    if result["mode"] == "primary_review_complete_source_identity_pending"
                ),
                "historicalQuarantinesSuperseded": sum(
                    1
                    for result in results
                    if "superseded_by_independent_review" in result["mode"]
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
