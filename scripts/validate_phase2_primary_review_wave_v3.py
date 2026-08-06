#!/usr/bin/env python3
"""Validate Phase 2 waves with visual-pending completions and next-wave assignment."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import validate_phase2_primary_review_wave as base
import validate_phase2_primary_review_wave_v2 as v2


def apply_next_wave_assignment(status: dict, overlay: dict) -> dict:
    assignment = overlay.get("nextWaveAssignment")
    if not isinstance(assignment, dict):
        return status

    review = status.get("review", {})
    expected = overlay.get("expectedBase", {})
    if review.get("primaryReviewWavesAssigned") != expected.get(
        "primaryReviewWavesAssigned"
    ):
        raise SystemExit("overlay base wave-assignment count is stale")
    if review.get("primaryReviewCompaniesAssignedTotal") != expected.get(
        "primaryReviewCompaniesAssignedTotal"
    ):
        raise SystemExit("overlay base assigned-company total is stale")

    review["primaryReviewWaveAssigned"] = assignment["assigned"]
    review["primaryReviewWavesAssigned"] = assignment["effectiveWavesAssigned"]
    review["primaryReviewCompaniesAssignedTotal"] = assignment[
        "effectiveCompaniesAssignedTotal"
    ]
    review["primaryReviewWaveFile"] = assignment["file"]

    wave_files = review.get("primaryReviewWaveFiles")
    if isinstance(wave_files, list) and assignment["file"] not in wave_files:
        wave_files.append(assignment["file"])

    active_work = status.get("activeWork")
    if not isinstance(active_work, list):
        raise SystemExit("activeWork must be an array")
    workstream = f"primary_review_wave{int(assignment['wave']):02d}"
    existing = next(
        (
            item
            for item in active_work
            if isinstance(item, dict) and item.get("workstream") == workstream
        ),
        None,
    )
    expected_item = {
        "workstream": workstream,
        "companies": assignment["assigned"],
        "status": assignment["status"],
        "completionCount": assignment["completionCount"],
        "remainingCount": assignment["remainingCount"],
        "file": assignment["file"],
    }
    if existing is None:
        active_work.append(expected_item)
    else:
        existing.update(expected_item)

    return status


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
    overlay = v2.load_overlay(repo_root / args.overlay)

    effective_wave = v2.apply_wave_overlay(wave, overlay)
    effective_status = v2.merge_status_overlay(status, overlay)
    effective_status = apply_next_wave_assignment(effective_status, overlay)

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
