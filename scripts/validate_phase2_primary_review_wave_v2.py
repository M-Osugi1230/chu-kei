#!/usr/bin/env python3
"""Validate Phase 2 review waves with an append-only completion overlay.

The v1 gate treated primary-review completion and independent-review readiness as
one state. This wrapper adds a safe intermediate state for companies whose
full-text, metrics, capital policy and field evidence have been reviewed, while
visual figure review is still pending. Such companies count as primary-review
complete but never as independent-review ready.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

import validate_phase2_primary_review_wave as base

PENDING_VISUAL_STATUS = "primary_review_complete_independent_visual_review_pending"
OVERLAY_SCHEMA = "phase2-review-state-overlay-v1"


def load_overlay(path: Path) -> dict[str, Any]:
    overlay = base.load_json(path)
    if overlay.get("schemaVersion") != OVERLAY_SCHEMA:
        raise SystemExit(f"unexpected overlay schema: {path}")
    if overlay.get("automaticFactCompletionAllowed") is not False:
        raise SystemExit("overlay must prohibit automatic fact completion")
    if overlay.get("automaticApprovalAllowed") is not False:
        raise SystemExit("overlay must prohibit automatic approval")
    if overlay.get("deepVerificationApproved") is not False:
        raise SystemExit("overlay must keep deep verification unapproved")
    base.assert_no_forbidden_true(overlay, "overlay")
    return overlay


def apply_wave_overlay(
    wave: dict[str, Any], overlay: dict[str, Any]
) -> dict[str, Any]:
    effective = copy.deepcopy(wave)
    if effective.get("wave") != overlay.get("wave"):
        return effective

    expected = overlay.get("expectedBase", {})
    base_counts = effective.get("counts", {})
    if base_counts.get("primaryReviewComplete") != expected.get(
        "wavePrimaryReviewComplete"
    ):
        raise SystemExit("overlay base wave completion count is stale")
    if base_counts.get("independentReviewReady") != expected.get(
        "waveIndependentReviewReady"
    ):
        raise SystemExit("overlay base wave ready count is stale")

    companies = effective.get("companies")
    if not isinstance(companies, list):
        raise SystemExit("wave companies must be an array")
    by_code = {str(company.get("code")): company for company in companies}

    completions = overlay.get("companyCompletions")
    if not isinstance(completions, list) or not completions:
        raise SystemExit("overlay companyCompletions must be a non-empty array")

    for completion in completions:
        if not isinstance(completion, dict):
            raise SystemExit("overlay completion must be an object")
        code = str(completion.get("code", ""))
        company = by_code.get(code)
        if company is None:
            raise SystemExit(f"overlay company is not assigned in wave: {code}")
        if company.get("order") != completion.get("order"):
            raise SystemExit(f"overlay order mismatch for {code}")
        if str(company.get("status")) not in base.ASSIGNED_STATUSES:
            raise SystemExit(f"overlay base company is not assigned: {code}")
        if completion.get("status") != PENDING_VISUAL_STATUS:
            raise SystemExit(f"unsupported overlay completion status for {code}")

        company.update(
            {
                "status": PENDING_VISUAL_STATUS,
                "reviewFile": completion.get("reviewFile"),
                "completedChecks": completion.get("completedChecks"),
                "pendingChecks": completion.get("pendingChecks"),
                "automaticApprovalAllowed": False,
                "deepVerificationApproved": False,
            }
        )

    effective_counts = overlay.get("effectiveCounts", {})
    effective["updatedAt"] = overlay.get("createdAt")
    effective["counts"]["primaryReviewComplete"] = effective_counts.get(
        "wavePrimaryReviewComplete"
    )
    effective["counts"]["independentReviewReady"] = effective_counts.get(
        "waveIndependentReviewReady"
    )
    effective["counts"]["independentVisualReviewPending"] = effective_counts.get(
        "waveIndependentVisualReviewPending"
    )
    return effective


def validate_pending_visual_company(
    company: dict[str, Any], repo_root: Path
) -> None:
    code = str(company.get("code", ""))
    if company.get("independentReviewFile") is not None:
        raise SystemExit(
            f"visual-pending company must not have independent packet: {code}"
        )
    completed_checks = company.get("completedChecks")
    if not isinstance(completed_checks, list):
        raise SystemExit(f"visual-pending company lacks completedChecks: {code}")
    for check in ("fullTextReview", "metricsValidation", "fieldLevelEvidence"):
        if check not in completed_checks:
            raise SystemExit(f"visual-pending company lacks {check}: {code}")
    if "visualFigureReview" in completed_checks:
        raise SystemExit(f"visual review was prematurely completed for {code}")
    pending_checks = company.get("pendingChecks")
    if not isinstance(pending_checks, list) or "visualFigureReview" not in pending_checks:
        raise SystemExit(f"visual review pending marker is missing for {code}")
    base.validate_primary_review_record(company, repo_root)


def validate_effective_wave(
    wave: dict[str, Any], repo_root: Path
) -> dict[str, int]:
    transformed = copy.deepcopy(wave)
    pending_count = 0

    for company, transformed_company in zip(
        wave.get("companies", []), transformed.get("companies", []), strict=True
    ):
        if company.get("status") != PENDING_VISUAL_STATUS:
            continue
        validate_pending_visual_company(company, repo_root)
        pending_count += 1
        transformed_company["status"] = "primary_review_assigned"
        for key in (
            "reviewFile",
            "independentReviewFile",
            "completedChecks",
            "pendingChecks",
            "automaticApprovalAllowed",
            "deepVerificationApproved",
        ):
            transformed_company.pop(key, None)

    ready_count = sum(
        1
        for company in transformed.get("companies", [])
        if company.get("status") == base.COMPLETED_STATUS
    )
    transformed["counts"]["primaryReviewComplete"] = ready_count
    transformed["counts"]["independentReviewReady"] = ready_count
    transformed["counts"].pop("independentVisualReviewPending", None)

    base_counts = base.validate_wave(transformed, repo_root)
    effective_counts = {
        "assigned": base_counts["assigned"],
        "primaryReviewComplete": base_counts["primaryReviewComplete"]
        + pending_count,
        "independentReviewReady": base_counts["independentReviewReady"],
        "independentVisualReviewPending": pending_count,
    }

    counts = wave.get("counts", {})
    for key in (
        "primaryReviewComplete",
        "independentReviewReady",
        "independentVisualReviewPending",
    ):
        if counts.get(key, 0) != effective_counts[key]:
            raise SystemExit(f"effective wave count mismatch for {key}")
    if counts.get("deepVerificationApproved") != 0:
        raise SystemExit("deepVerificationApproved must remain zero")

    return effective_counts


def merge_status_overlay(
    status: dict[str, Any], overlay: dict[str, Any]
) -> dict[str, Any]:
    effective = copy.deepcopy(status)
    expected = overlay.get("expectedBase", {})
    review = effective.get("review", {})

    for field in (
        "primaryReviewComplete",
        "independentReviewReady",
        "remainingPrimaryReviews",
    ):
        if review.get(field) != expected.get(field):
            raise SystemExit(f"overlay base status is stale for {field}")

    records = effective.get("completedPrimaryReviews")
    if not isinstance(records, list):
        raise SystemExit("completedPrimaryReviews must be an array")
    existing_codes = {str(record.get("code")) for record in records}

    for completion in overlay.get("companyCompletions", []):
        code = str(completion["code"])
        if code in existing_codes:
            raise SystemExit(f"overlay completion is already materialized: {code}")
        records.append(
            {
                "order": completion["order"],
                "code": code,
                "name": completion["name"],
                "reviewFile": completion["reviewFile"],
                "status": completion["status"],
                "sourceCorrectionRequired": False,
                "sourceClassification": completion.get("sourceClassification"),
            }
        )
        existing_codes.add(code)

    counts = overlay.get("effectiveCounts", {})
    review["sourceIdentityConfirmed"] = counts["primaryReviewComplete"]
    review["formalPlanConfirmed"] = counts["primaryReviewComplete"]
    review["primaryReviewComplete"] = counts["primaryReviewComplete"]
    review["independentReviewReady"] = counts["independentReviewReady"]
    review["remainingPrimaryReviews"] = counts["remainingPrimaryReviews"]

    workstream = f"primary_review_wave{int(overlay['wave']):02d}"
    active_work = effective.get("activeWork")
    if not isinstance(active_work, list):
        raise SystemExit("activeWork must be an array")
    wave_work = next(
        (
            item
            for item in active_work
            if isinstance(item, dict) and item.get("workstream") == workstream
        ),
        None,
    )
    if wave_work is None:
        raise SystemExit(f"activeWork lacks {workstream}")
    wave_work["status"] = "complete"
    wave_work["completionCount"] = counts["wavePrimaryReviewComplete"]
    wave_work["remainingCount"] = 0

    effective["updatedAt"] = overlay.get("createdAt")
    base.assert_no_forbidden_true(effective, "effectiveStatus")
    return effective


def status_wave_for_base_validator(wave: dict[str, Any]) -> dict[str, Any]:
    transformed = copy.deepcopy(wave)
    for company in transformed.get("companies", []):
        if company.get("status") == PENDING_VISUAL_STATUS:
            company["status"] = base.COMPLETED_STATUS
    return transformed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wave", required=True)
    parser.add_argument("--status", required=True)
    parser.add_argument("--overlay", required=True)
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    wave = base.load_json(repo_root / args.wave)
    status = base.load_json(repo_root / args.status)
    overlay = load_overlay(repo_root / args.overlay)

    effective_wave = apply_wave_overlay(wave, overlay)
    effective_status = merge_status_overlay(status, overlay)
    wave_counts = validate_effective_wave(effective_wave, repo_root)
    cross_wave_counts = base.validate_cross_wave_uniqueness(repo_root)

    base.validate_status(
        effective_status,
        status_wave_for_base_validator(effective_wave),
        wave_counts,
        cross_wave_counts,
        repo_root,
    )

    print(
        json.dumps(
            {
                "status": "ok",
                "wave": effective_wave["wave"],
                "assignedCompanies": wave_counts["assigned"],
                "wavePrimaryReviewComplete": wave_counts["primaryReviewComplete"],
                "waveIndependentReviewReady": wave_counts["independentReviewReady"],
                "waveIndependentVisualReviewPending": wave_counts[
                    "independentVisualReviewPending"
                ],
                "allWaveCount": cross_wave_counts["waveCount"],
                "allWaveAssignedCompanies": cross_wave_counts[
                    "assignedCompaniesTotal"
                ],
                "primaryReviewComplete": effective_status["review"][
                    "primaryReviewComplete"
                ],
                "independentReviewReady": effective_status["review"][
                    "independentReviewReady"
                ],
                "remainingPrimaryReviews": effective_status["review"][
                    "remainingPrimaryReviews"
                ],
                "deepVerificationApproved": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
