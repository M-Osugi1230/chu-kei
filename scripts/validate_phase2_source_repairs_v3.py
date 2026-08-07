#!/usr/bin/env python3
"""Phase 2 source-repair validator including formal-plan-search quarantines.

v2 handles legacy history, independent source resolutions, primary-review-complete
source-identity-pending states, and superseded quarantines. This layer adds the
explicit quarantine used when an official growth-potential document confirms that
a formal medium-term plan has not yet been published.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import validate_phase2_source_repairs_v2 as v2

legacy = v2.legacy
FORMAL_SEARCH_STATUS = "source_isolated_formal_plan_search_required"
FORMAL_SEARCH_FINDING = "formal_management_plan_boundary_not_met"


def validate_formal_plan_search_quarantine(
    repair: dict[str, Any],
    repair_path: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    legacy.assert_no_automatic_approval(repair, str(repair_path))
    code = legacy.company_code(repair, repair_path)
    if code in completed_records:
        raise SystemExit(f"formal-plan-search quarantine is already canonical-complete: {code}")

    candidate = repair.get("candidate")
    if not isinstance(candidate, dict):
        raise SystemExit(f"formal-plan-search quarantine lacks candidate: {code}")
    legacy.validate_pdf_identity(candidate, f"{repair_path}.candidate")
    if candidate.get("documentTypeCandidate") != "growth_potential_document":
        raise SystemExit(f"formal-plan-search candidate type is not growth_potential_document: {code}")

    finding = repair.get("finding")
    if not isinstance(finding, dict) or finding.get("type") != FORMAL_SEARCH_FINDING:
        raise SystemExit(f"unsupported formal-plan-search finding: {repair_path}")
    legacy.require_true(finding, "sourceIdentityConfirmed", f"{repair_path}.finding")
    legacy.require_true(
        finding, "growthPotentialDocumentConfirmed", f"{repair_path}.finding"
    )
    legacy.require_false(
        finding, "formalManagementPlanConfirmed", f"{repair_path}.finding"
    )
    evidence = finding.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise SystemExit(f"formal-plan-search quarantine lacks evidence: {code}")
    for index, item in enumerate(evidence):
        if not isinstance(item, dict):
            raise SystemExit(f"invalid formal-plan-search evidence item: {code}:{index}")
        page = item.get("pdfPage")
        if not isinstance(page, int) or page <= 0 or page > candidate.get("pageCount", 0):
            raise SystemExit(f"invalid formal-plan-search evidence page: {code}:{index}")
        v2.require_string(item.get("statement"), f"{repair_path}.finding.evidence[{index}].statement")
    v2.require_string(finding.get("reason"), f"{repair_path}.finding.reason")

    resolution = repair.get("resolution")
    if not isinstance(resolution, dict) or resolution.get("status") != FORMAL_SEARCH_STATUS:
        raise SystemExit(f"formal-plan-search resolution status invalid: {code}")
    legacy.require_false(resolution, "waveEligibility", f"{repair_path}.resolution")
    legacy.require_true(resolution, "replacementRequired", f"{repair_path}.resolution")
    actions = resolution.get("nextActions")
    if not isinstance(actions, list) or not actions:
        raise SystemExit(f"formal-plan-search quarantine lacks nextActions: {code}")
    replacement = resolution.get("replacementCompany")
    if replacement is not None:
        if not isinstance(replacement, dict):
            raise SystemExit(f"replacementCompany must be an object: {code}")
        v2.require_string(replacement.get("code"), f"{repair_path}.replacementCompany.code")
        v2.require_string(replacement.get("name"), f"{repair_path}.replacementCompany.name")
        v2.require_string(replacement.get("reason"), f"{repair_path}.replacementCompany.reason")

    approval = repair.get("approval")
    if not isinstance(approval, dict):
        raise SystemExit(f"formal-plan-search quarantine lacks approval: {code}")
    legacy.require_false(approval, "automaticApprovalAllowed", f"{repair_path}.approval")
    legacy.require_false(approval, "deepVerificationApproved", f"{repair_path}.approval")

    return {
        "code": code,
        "mode": "formal_plan_search_quarantine",
        "quarantined": True,
        "resolutionStatus": FORMAL_SEARCH_STATUS,
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
        resolution = repair.get("resolution")
        is_formal_search_quarantine = (
            schema == legacy.CORRECTED_SCHEMA
            and isinstance(resolution, dict)
            and resolution.get("status") == FORMAL_SEARCH_STATUS
            and resolution.get("waveEligibility") is False
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
        elif is_formal_search_quarantine:
            if v2.load_completion(repo_root, legacy.company_code(repair, repair_path)) is not None:
                raise SystemExit(
                    "formal-plan-search quarantine has later completion; add explicit "
                    "supersession evidence before allowing it"
                )
            result = validate_formal_plan_search_quarantine(
                repair, repair_path, completed_records
            )
        else:
            kind = v2.quarantine_kind(repair)
            code = legacy.company_code(repair, repair_path)
            if kind is not None and v2.load_completion(repo_root, code) is not None:
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
