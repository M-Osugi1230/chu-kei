#!/usr/bin/env python3
"""Validate Phase 2 waves when historical overlays are already materialized.

v4 composes append-only overlays on top of an older current-status snapshot. Once
those completions are incorporated into current-status, replaying the same
historical overlays is invalid. This wrapper keeps v4's wave transformation and
strict base validation, but uses the canonical current-status directly when all
overlay completion records are already materialized there.

Historical overlay files may repeat a company after an earlier partial-completion
snapshot. That repetition is permitted only for materialization detection; wave
assignment uniqueness remains enforced by the base validator and each overlay is
applied only to its own wave.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

import validate_phase2_primary_review_wave as base
import validate_phase2_primary_review_wave_v2 as v2
import validate_phase2_primary_review_wave_v3 as v3
import validate_phase2_primary_review_wave_v4 as v4


def overlay_codes(overlays: list[dict[str, Any]]) -> set[str]:
    result: set[str] = set()
    for overlay in overlays:
        completions = overlay.get("companyCompletions")
        if not isinstance(completions, list) or not completions:
            raise SystemExit("overlay companyCompletions must be a non-empty array")
        local_codes: set[str] = set()
        for completion in completions:
            if not isinstance(completion, dict):
                raise SystemExit("overlay completion must be an object")
            code = str(completion.get("code", "")).strip()
            if not code:
                raise SystemExit("overlay completion lacks code")
            if code in local_codes:
                raise SystemExit(
                    f"duplicate completion inside overlay wave {overlay.get('wave')}: {code}"
                )
            local_codes.add(code)
            result.add(code)
    return result


def canonical_completed_codes(status: dict[str, Any]) -> set[str]:
    records = status.get("completedPrimaryReviews")
    if not isinstance(records, list):
        raise SystemExit("completedPrimaryReviews must be an array")
    result: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            raise SystemExit("completedPrimaryReviews entries must be objects")
        code = str(record.get("code", "")).strip()
        if not code:
            raise SystemExit("canonical completed record lacks code")
        if code in result:
            raise SystemExit(f"duplicate canonical completed code: {code}")
        result.add(code)
    return result


def overlays_are_materialized(
    status: dict[str, Any], overlays: list[dict[str, Any]]
) -> bool:
    required = overlay_codes(overlays)
    completed = canonical_completed_codes(status)
    if not required.issubset(completed):
        return False

    review = status.get("review")
    if not isinstance(review, dict):
        raise SystemExit("status.review must be an object")
    primary_complete = review.get("primaryReviewComplete")
    if not isinstance(primary_complete, int):
        raise SystemExit("status.review.primaryReviewComplete must be integer")
    if primary_complete != len(completed):
        raise SystemExit(
            "status.review.primaryReviewComplete does not match materialized records"
        )
    return True


def replay_overlays(
    status: dict[str, Any], overlays: list[dict[str, Any]]
) -> dict[str, Any]:
    first_overlay, *remaining_overlays = overlays
    effective_status = v2.merge_status_overlay(status, first_overlay)
    if first_overlay.get("nextWaveAssignment") is not None:
        effective_status = v3.apply_next_wave_assignment(
            effective_status, first_overlay
        )

    for overlay in remaining_overlays:
        effective_status = v4.merge_partial_completion_overlay(
            effective_status, overlay
        )
        if overlay.get("nextWaveAssignment") is not None:
            effective_status = v3.apply_next_wave_assignment(
                effective_status, overlay
            )
    return effective_status


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

    effective_wave = copy.deepcopy(wave)
    for overlay in overlays:
        effective_wave = v2.apply_wave_overlay(effective_wave, overlay)

    materialized = overlays_are_materialized(status, overlays)
    effective_status = copy.deepcopy(status) if materialized else replay_overlays(
        status, overlays
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
                "historicalOverlaysMaterialized": materialized,
                "deepVerificationApproved": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
