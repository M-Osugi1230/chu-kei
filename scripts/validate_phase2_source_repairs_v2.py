#!/usr/bin/env python3
"""Extend the Phase 2 source-repair gate for independent source-resolution records.

The original validator remains authoritative for its legacy/corrected schemas.
This wrapper adds strict validation for the append-only
quality-rebase-phase2-independent-source-resolution-v1 records introduced by
independent review, without weakening any existing checks.

Multiple resolution records for one company are allowed because source repair is
append-only: an earlier primary-review source-resolution and a later independent-
review source-resolution may legitimately coexist. Every file is still validated
independently and resolved records must point to a coherent completion artifact.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import validate_phase2_source_repairs as legacy

INDEPENDENT_SCHEMA = "quality-rebase-phase2-independent-source-resolution-v1"
INDEPENDENT_COMPLETION_SCHEMA = "quality-rebase-phase2-independent-completion-v1"


def require_string(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"missing string: {location}")
    return value.strip()


def validate_completion(
    repair: dict[str, Any], repair_path: Path, repo_root: Path, code: str
) -> None:
    completion_path = (
        repo_root
        / "operations/quality-rebase/phase2/independent-completions"
        / f"{code}-independent-completion-v1.json"
    )
    completion = legacy.load_json(completion_path)
    if completion.get("schemaVersion") != INDEPENDENT_COMPLETION_SCHEMA:
        raise SystemExit(f"unexpected independent completion schema: {completion_path}")

    company = completion.get("company")
    if not isinstance(company, dict) or str(company.get("code", "")) != code:
        raise SystemExit(f"independent completion company mismatch: {code}")
    if completion.get("status") != "independent_review_complete":
        raise SystemExit(f"independent completion is not complete: {code}")

    source = completion.get("source")
    canonical = repair.get("canonicalSource")
    if not isinstance(source, dict) or not isinstance(canonical, dict):
        raise SystemExit(f"resolved source metadata missing for {code}")
    legacy.validate_pdf_identity(canonical, f"{repair_path}.canonicalSource")
    for key in ("officialUrl", "pdfSha256", "pageCount"):
        if source.get(key) != canonical.get(key):
            raise SystemExit(f"completion/canonical source mismatch for {code}: {key}")

    review = completion.get("review")
    if not isinstance(review, dict):
        raise SystemExit(f"independent completion review section missing: {code}")
    if review.get("automaticApprovalAllowed") is not False:
        raise SystemExit(f"independent completion automatic approval must be false: {code}")
    if review.get("deepVerificationApproved") is not False:
        raise SystemExit(f"independent completion deep verification must be false: {code}")

    blockers = completion.get("finalDeepVerificationBlockers")
    if blockers is not None and not isinstance(blockers, list):
        raise SystemExit(f"finalDeepVerificationBlockers must be an array: {code}")

    evidence_correction = repair.get("evidenceCorrectionFile")
    if evidence_correction is not None:
        correction_path = repo_root / require_string(
            evidence_correction, f"{repair_path}.evidenceCorrectionFile"
        )
        correction = legacy.load_json(correction_path)
        correction_company = correction.get("company")
        if not isinstance(correction_company, dict) or str(
            correction_company.get("code", "")
        ) != code:
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
        raise SystemExit(
            f"independentReviewCompletionBlocked must be boolean: {repair_path}"
        )

    completion_path = (
        repo_root
        / "operations/quality-rebase/phase2/independent-completions"
        / f"{code}-independent-completion-v1.json"
    )

    if blocked:
        checks = repair.get("requiredNextChecks")
        if not isinstance(checks, list) or not checks:
            raise SystemExit(f"blocked source resolution lacks requiredNextChecks: {code}")
        if completion_path.exists():
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
    validate_completion(repair, repair_path, repo_root, code)

    return {
        "code": code,
        "mode": "independent_source_resolved",
        "quarantined": False,
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
        if schema == INDEPENDENT_SCHEMA:
            result = validate_independent_resolution(repair, repair_path, repo_root)
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
                    {
                        str(result["code"])
                        for result in results
                        if result["quarantined"]
                    }
                ),
                "independentSourceBlocked": sum(
                    1
                    for result in results
                    if result["mode"] == "independent_source_blocked"
                ),
                "independentSourceResolved": sum(
                    1
                    for result in results
                    if result["mode"] == "independent_source_resolved"
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
