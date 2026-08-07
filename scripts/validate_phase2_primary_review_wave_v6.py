#!/usr/bin/env python3
"""Primary-review wave validator with shared overlay audit fields.

Some later append-only overlays store completed/pending checks once at overlay
level (`completedChecksForAll` / `pendingChecksForAll`) rather than repeating the
same arrays for every company. v5 already handles monotonic materialization and
strict effective-status reconciliation; this layer only normalizes that documented
shared-field representation before invoking v5's validation flow.
"""

from __future__ import annotations

import copy
from typing import Any

import validate_phase2_primary_review_wave as base
import validate_phase2_primary_review_wave_v2 as v2
import validate_phase2_primary_review_wave_v5 as v5


def overlay_value(
    completion: dict[str, Any], overlay: dict[str, Any], field: str
) -> Any:
    value = completion.get(field)
    if value is not None:
        return value
    shared_key = {
        "completedChecks": "completedChecksForAll",
        "pendingChecks": "pendingChecksForAll",
    }.get(field)
    if shared_key is None:
        return None
    return overlay.get(shared_key)


def hydrate_field(
    company: dict[str, Any],
    completion: dict[str, Any],
    overlay: dict[str, Any],
    field: str,
    code: str,
) -> None:
    expected = overlay_value(completion, overlay, field)
    current = company.get(field)
    if current is None:
        company[field] = copy.deepcopy(expected)
    elif expected is not None and current != expected:
        raise SystemExit(f"materialized overlay {field} mismatch for {code}")


def materialize_wave_overlay(
    wave: dict[str, Any], overlay: dict[str, Any] | None
) -> dict[str, Any]:
    effective = copy.deepcopy(wave)
    if overlay is None:
        return effective
    if effective.get("wave") != overlay.get("wave"):
        raise SystemExit("overlay wave number does not match wave file")

    companies = effective.get("companies")
    if not isinstance(companies, list):
        raise SystemExit("wave companies must be an array")
    by_code = {str(company.get("code", "")): company for company in companies}

    completions = overlay.get("companyCompletions")
    if not isinstance(completions, list) or not completions:
        raise SystemExit("overlay companyCompletions must be a non-empty array")

    shared_completed = overlay.get("completedChecksForAll")
    shared_pending = overlay.get("pendingChecksForAll")
    if shared_completed is not None and (
        not isinstance(shared_completed, list) or not shared_completed
    ):
        raise SystemExit("completedChecksForAll must be a non-empty array when present")
    if shared_pending is not None and (
        not isinstance(shared_pending, list) or not shared_pending
    ):
        raise SystemExit("pendingChecksForAll must be a non-empty array when present")

    seen: set[str] = set()
    for completion in completions:
        if not isinstance(completion, dict):
            raise SystemExit("overlay completion must be an object")
        code = str(completion.get("code", "")).strip()
        if not code or code in seen:
            raise SystemExit(f"invalid or duplicate overlay completion: {code}")
        seen.add(code)
        company = by_code.get(code)
        if company is None:
            raise SystemExit(f"overlay company is not assigned in wave: {code}")
        if company.get("order") != completion.get("order"):
            raise SystemExit(f"overlay order mismatch for {code}")
        if completion.get("status") != v2.PENDING_VISUAL_STATUS:
            raise SystemExit(f"unsupported overlay completion status for {code}")

        review_file = completion.get("reviewFile")
        completed_checks = overlay_value(completion, overlay, "completedChecks")
        pending_checks = overlay_value(completion, overlay, "pendingChecks")
        if not isinstance(completed_checks, list) or not completed_checks:
            raise SystemExit(f"overlay lacks completed checks for {code}")
        if not isinstance(pending_checks, list) or not pending_checks:
            raise SystemExit(f"overlay lacks pending checks for {code}")

        current_status = str(company.get("status", ""))
        if current_status in base.ASSIGNED_STATUSES:
            company.update(
                {
                    "status": v2.PENDING_VISUAL_STATUS,
                    "reviewFile": review_file,
                    "completedChecks": copy.deepcopy(completed_checks),
                    "pendingChecks": copy.deepcopy(pending_checks),
                    "automaticApprovalAllowed": False,
                    "deepVerificationApproved": False,
                }
            )
        elif current_status == v2.PENDING_VISUAL_STATUS:
            hydrate_field(company, completion, overlay, "reviewFile", code)
            hydrate_field(company, completion, overlay, "completedChecks", code)
            hydrate_field(company, completion, overlay, "pendingChecks", code)
            if company.get("automaticApprovalAllowed") not in (None, False):
                raise SystemExit(f"visual-pending automatic approval enabled for {code}")
            if company.get("deepVerificationApproved") not in (None, False):
                raise SystemExit(f"visual-pending deep verification enabled for {code}")
            company["automaticApprovalAllowed"] = False
            company["deepVerificationApproved"] = False
        elif current_status == base.COMPLETED_STATUS:
            if company.get("reviewFile") != review_file:
                raise SystemExit(f"advanced wave reviewFile mismatch for {code}")
        else:
            raise SystemExit(
                f"unsupported wave status for historical overlay company {code}: "
                f"{current_status}"
            )

    ready_count = sum(
        1 for company in companies if company.get("status") == base.COMPLETED_STATUS
    )
    pending_visual_count = sum(
        1 for company in companies if company.get("status") == v2.PENDING_VISUAL_STATUS
    )
    counts = effective.get("counts")
    if not isinstance(counts, dict):
        raise SystemExit("wave counts must be an object")
    counts["primaryReviewComplete"] = ready_count + pending_visual_count
    counts["independentReviewReady"] = ready_count
    counts["independentVisualReviewPending"] = pending_visual_count
    counts["deepVerificationApproved"] = 0
    return effective


v5.materialize_wave_overlay = materialize_wave_overlay

if __name__ == "__main__":
    v5.main()
