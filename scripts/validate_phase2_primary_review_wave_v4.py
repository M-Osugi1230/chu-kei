#!/usr/bin/env python3
"""Validate Phase 2 waves by composing append-only review overlays in order."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import validate_phase2_primary_review_wave as base
import validate_phase2_primary_review_wave_v2 as v2
import validate_phase2_primary_review_wave_v3 as v3


def merge_partial_completion_overlay(
    status: dict[str, Any], overlay: dict[str, Any]
) -> dict[str, Any]:
    expected = overlay.get("expectedBase", {})
    review = status.get("review", {})
    for field in (
        "primaryReviewComplete",
        "independentReviewReady",
        "remainingPrimaryReviews",
        "primaryReviewWavesAssigned",
        "primaryReviewCompaniesAssignedTotal",
    ):
        if review.get(field) != expected.get(field):
            raise SystemExit(f"partial overlay base status is stale for {field}")

    records = status.get("completedPrimaryReviews")
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

    active_work = status.get("activeWork")
    if not isinstance(active_work, list):
        raise SystemExit("activeWork must be an array")
    workstream = f"primary_review_wave{int(overlay['wave']):02d}"
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

    wave_complete = counts["wavePrimaryReviewComplete"]
    assigned = int(wave_work["companies"])
    wave_work["completionCount"] = wave_complete
    wave_work["remainingCount"] = assigned - wave_complete
    wave_work["status"] = "complete" if wave_complete == assigned else "in_progress"

    status["updatedAt"] = overlay.get("createdAt")
    base.assert_no_forbidden_true(status, "effectiveStatus")
    return status


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wave", required=True)
    parser.add_argument("--status", required=True)
    parser.add_argument("--overlay", action="append", required=True)
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    wave = base.load_json(repo_root / args.wave)
    status = base.load_json(repo_root / args.status)
    overlays = [v2.load_overlay(repo_root / path) for path in args.overlay]
    overlays.sort(key=lambda item: int(item["wave"]))

    overlay_waves = [int(item["wave"]) for item in overlays]
    expected_waves = list(range(7, 7 + len(overlays)))
    if overlay_waves != expected_waves:
        raise SystemExit(
            f"expected consecutive overlays {expected_waves}, got {overlay_waves}"
        )

    effective_wave = wave
    for overlay in overlays:
        effective_wave = v2.apply_wave_overlay(effective_wave, overlay)

    first_overlay, *remaining_overlays = overlays
    effective_status = v2.merge_status_overlay(status, first_overlay)
    if first_overlay.get("nextWaveAssignment") is not None:
        effective_status = v3.apply_next_wave_assignment(
            effective_status, first_overlay
        )

    for overlay in remaining_overlays:
        effective_status = merge_partial_completion_overlay(
            effective_status, overlay
        )
        if overlay.get("nextWaveAssignment") is not None:
            effective_status = v3.apply_next_wave_assignment(
                effective_status, overlay
            )

    wave_counts = v2.validate_effective_wave(effective_wave, repo_root)
    cross_wave_counts = base.validate_cross_wave_uniqueness(repo_root)
    base.validate_status(
        effective_status,
        v2.status_wave_for_base_validator(effective_wave),
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
                "waveIndependentVisualReviewPending": wave_counts.get(
                    "independentVisualReviewPending", 0
                ),
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
                "activeWaveFile": effective_status["review"][
                    "primaryReviewWaveFile"
                ],
                "deepVerificationApproved": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
