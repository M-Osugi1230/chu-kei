#!/usr/bin/env python3
"""Phase 2 source-repair validator with robust hash-pending supersession dispatch.

v4 contains the strict validation routine for an old legacy quarantine that was
later superseded by a human primary review while the current official PDF hash is
still pending. This wrapper dispatches that state from its observable evidence
(current official document has no SHA-256, canonical primary review is complete,
no independent completion exists) rather than relying on historical booleans
alone.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import validate_phase2_source_repairs_v2 as v2
import validate_phase2_source_repairs_v3 as v3
import validate_phase2_source_repairs_v4 as v4

legacy = v2.legacy


def is_hash_pending_primary_supersession(
    repair: dict[str, Any],
    code: str,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> bool:
    if repair.get("schemaVersion") != legacy.LEGACY_SCHEMA:
        return False
    if code not in completed_records:
        return False
    if v2.load_completion(repo_root, code) is not None:
        return False
    if repair.get("independentReviewReady") is not False:
        return False
    current = repair.get("currentOfficialDocument")
    if not isinstance(current, dict):
        return False
    if current.get("pdfSha256") is not None:
        return False
    if not isinstance(current.get("pageCount"), int) or current.get("pageCount", 0) <= 0:
        return False
    primary_path = repo_root / f"operations/quality-rebase/phase2/reviews/{code}-primary-review-v1.json"
    if not primary_path.exists():
        return False
    primary = legacy.load_json(primary_path)
    review = primary.get("review")
    if not isinstance(review, dict):
        return False
    return str(review.get("status", "")).startswith("primary_review_complete")


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
        has_completion = v2.load_completion(repo_root, code) is not None
        is_formal_search_quarantine = (
            schema == legacy.CORRECTED_SCHEMA
            and isinstance(resolution, dict)
            and resolution.get("status") == v3.FORMAL_SEARCH_STATUS
            and resolution.get("waveEligibility") is False
        )

        if schema == v2.INDEPENDENT_SCHEMA:
            result = v2.validate_independent_resolution(repair, repair_path, repo_root)
        elif is_hash_pending_primary_supersession(
            repair, code, repo_root, completed_records
        ):
            result = v4.validate_primary_review_hash_pending(
                repair, repair_path, repo_root, completed_records
            )
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
                "hashPendingPrimarySupersessions": sum(
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
