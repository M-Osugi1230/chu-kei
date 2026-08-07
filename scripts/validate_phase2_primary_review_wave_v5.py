#!/usr/bin/env python3
"""Validate all Phase 2 primary-review waves against the effective status.

Historical review overlays are append-only snapshots. A raw wave may later be
advanced beyond the state captured by its overlay, so validation must be
monotonic: apply an overlay only to still-assigned companies and never downgrade
a company that has subsequently reached independent-review-ready.

The validator strictly checks every wave/review artifact, cross-wave uniqueness,
and aggregate reconciliation with effective-status-v1.json. It never infers an
approval or deep-verification state.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

import validate_phase2_primary_review_wave as base
import validate_phase2_primary_review_wave_v2 as v2

EFFECTIVE_SCHEMA = "quality-rebase-phase2-effective-status-v1"


def rel(path: Path, repo_root: Path) -> str:
    return path.relative_to(repo_root).as_posix()


def require_int(value: Any, location: str) -> int:
    if not isinstance(value, int):
        raise SystemExit(f"{location} must be an integer")
    return value


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

        current_status = str(company.get("status", ""))
        if current_status in base.ASSIGNED_STATUSES:
            company.update(
                {
                    "status": v2.PENDING_VISUAL_STATUS,
                    "reviewFile": completion.get("reviewFile"),
                    "completedChecks": completion.get("completedChecks"),
                    "pendingChecks": completion.get("pendingChecks"),
                    "automaticApprovalAllowed": False,
                    "deepVerificationApproved": False,
                }
            )
        elif current_status == v2.PENDING_VISUAL_STATUS:
            if company.get("reviewFile") != completion.get("reviewFile"):
                raise SystemExit(f"materialized overlay reviewFile mismatch for {code}")
        elif current_status == base.COMPLETED_STATUS:
            # The raw wave progressed after this historical visual-pending overlay.
            # Never downgrade it, but require the same primary-review artifact.
            if company.get("reviewFile") != completion.get("reviewFile"):
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
    primary_complete = ready_count + pending_visual_count
    counts = effective.get("counts")
    if not isinstance(counts, dict):
        raise SystemExit("wave counts must be an object")
    counts["primaryReviewComplete"] = primary_complete
    counts["independentReviewReady"] = ready_count
    counts["independentVisualReviewPending"] = pending_visual_count
    counts["deepVerificationApproved"] = 0
    return effective


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--effective-status",
        default="operations/quality-rebase/phase2/effective-status-v1.json",
    )
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    phase2_root = repo_root / "operations/quality-rebase/phase2"
    wave_paths = sorted(phase2_root.glob("primary-review-wave*-v1.json"))
    overlay_paths = sorted(
        (phase2_root / "review-state-overlays").glob(
            "wave*-primary-completion-v1.json"
        )
    )
    if not wave_paths:
        raise SystemExit("no Phase 2 primary-review wave files found")

    overlays: dict[int, dict[str, Any]] = {}
    for path in overlay_paths:
        overlay = v2.load_overlay(path)
        wave_no = require_int(overlay.get("wave"), f"{path}.wave")
        if wave_no in overlays:
            raise SystemExit(f"duplicate overlay for wave {wave_no}")
        expected_base_wave = (
            f"operations/quality-rebase/phase2/primary-review-wave{wave_no:02d}-v1.json"
        )
        if overlay.get("baseWaveFile") != expected_base_wave:
            raise SystemExit(f"overlay baseWaveFile mismatch for wave {wave_no}")
        overlays[wave_no] = overlay

    aggregate = {
        "assigned": 0,
        "primaryReviewComplete": 0,
        "independentReviewReady": 0,
        "independentVisualReviewPending": 0,
        "additionalSourceMappingRequired": 0,
    }
    followup_counts: dict[int, dict[str, int]] = {}
    latest_wave: dict[str, Any] | None = None
    latest_counts: dict[str, int] | None = None

    for path in wave_paths:
        wave = base.load_json(path)
        wave_no = require_int(wave.get("wave"), f"{path}.wave")
        effective_wave = materialize_wave_overlay(wave, overlays.get(wave_no))
        counts = v2.validate_effective_wave(effective_wave, repo_root)

        aggregate["assigned"] += counts["assigned"]
        aggregate["primaryReviewComplete"] += counts["primaryReviewComplete"]
        aggregate["independentReviewReady"] += counts["independentReviewReady"]
        aggregate["independentVisualReviewPending"] += counts[
            "independentVisualReviewPending"
        ]
        source_mapping = (
            counts["primaryReviewComplete"]
            - counts["independentReviewReady"]
            - counts["independentVisualReviewPending"]
        )
        if source_mapping < 0:
            raise SystemExit(f"negative source-mapping count in wave {wave_no}")
        aggregate["additionalSourceMappingRequired"] += source_mapping

        if counts["independentVisualReviewPending"] > 0:
            followup_counts[wave_no] = {
                "primaryReviewComplete": counts["primaryReviewComplete"],
                "independentReviewReady": counts["independentReviewReady"],
                "independentVisualReviewPending": counts[
                    "independentVisualReviewPending"
                ],
            }
        latest_wave = effective_wave
        latest_counts = counts

    cross = base.validate_cross_wave_uniqueness(repo_root)
    if cross["waveCount"] != len(wave_paths):
        raise SystemExit("cross-wave wave count mismatch")
    if cross["assignedCompaniesTotal"] != aggregate["assigned"]:
        raise SystemExit("cross-wave assigned-company total mismatch")

    summary = base.load_json(repo_root / args.effective_status)
    if summary.get("schemaVersion") != EFFECTIVE_SCHEMA:
        raise SystemExit("unexpected effective-status schema")
    base.assert_no_forbidden_true(summary, "effectiveStatusSummary")

    expected_applied = [rel(path, repo_root) for path in overlay_paths]
    if summary.get("appliedOverlays") != expected_applied:
        raise SystemExit("effective-status appliedOverlays does not match overlay files")

    targets = summary.get("targets")
    if not isinstance(targets, dict) or targets.get("phase2Additional") != 450:
        raise SystemExit("effective-status phase2Additional target must be 450")

    assignment = summary.get("assignment")
    if not isinstance(assignment, dict):
        raise SystemExit("effective-status assignment must be an object")
    if assignment.get("primaryReviewWavesAssigned") != len(wave_paths):
        raise SystemExit("effective-status wave count mismatch")
    if assignment.get("phase2CompaniesAssignedTotal") != aggregate["assigned"]:
        raise SystemExit(
            f"effective-status assigned-company total mismatch: expected "
            f"{aggregate['assigned']}, got {assignment.get('phase2CompaniesAssignedTotal')}"
        )
    if assignment.get("currentWaveFile") != rel(wave_paths[-1], repo_root):
        raise SystemExit("effective-status currentWaveFile is not the latest wave")

    review = summary.get("review")
    if not isinstance(review, dict):
        raise SystemExit("effective-status review must be an object")
    expected_review = {
        "phase2PrimaryReviewComplete": aggregate["primaryReviewComplete"],
        "independentReviewReady": aggregate["independentReviewReady"],
        "independentVisualReviewPending": aggregate["independentVisualReviewPending"],
        "additionalSourceMappingRequired": aggregate["additionalSourceMappingRequired"],
        "remainingPhase2PrimaryReviews": 450 - aggregate["primaryReviewComplete"],
        "deepVerificationApproved": 0,
    }
    for key, expected in expected_review.items():
        if review.get(key) != expected:
            raise SystemExit(
                f"effective-status review mismatch for {key}: "
                f"expected {expected}, got {review.get(key)}"
            )
    if review.get("independentReviewComplete") != 0:
        raise SystemExit("effective-status independentReviewComplete must remain zero")

    if latest_wave is None or latest_counts is None:
        raise SystemExit("latest wave was not resolved")
    active = summary.get("activeWave")
    if not isinstance(active, dict):
        raise SystemExit("effective-status activeWave must be an object")
    expected_active = {
        "wave": latest_wave.get("wave"),
        "assigned": latest_counts["assigned"],
        "primaryReviewComplete": latest_counts["primaryReviewComplete"],
        "independentReviewReady": latest_counts["independentReviewReady"],
        "independentVisualReviewPending": latest_counts[
            "independentVisualReviewPending"
        ],
        "remaining": latest_counts["assigned"] - latest_counts["primaryReviewComplete"],
    }
    for key, expected in expected_active.items():
        if active.get(key) != expected:
            raise SystemExit(
                f"effective-status activeWave mismatch for {key}: "
                f"expected {expected}, got {active.get(key)}"
            )

    declared_followups = summary.get("openVisualFollowups")
    if not isinstance(declared_followups, list):
        raise SystemExit("effective-status openVisualFollowups must be an array")
    declared_map: dict[int, dict[str, int]] = {}
    for item in declared_followups:
        if not isinstance(item, dict):
            raise SystemExit("invalid openVisualFollowups entry")
        wave_no = require_int(item.get("wave"), "openVisualFollowups.wave")
        if wave_no in declared_map:
            raise SystemExit(f"duplicate openVisualFollowups wave: {wave_no}")
        declared_map[wave_no] = {
            "primaryReviewComplete": require_int(
                item.get("primaryReviewComplete"), "followup.primaryReviewComplete"
            ),
            "independentReviewReady": require_int(
                item.get("independentReviewReady"), "followup.independentReviewReady"
            ),
            "independentVisualReviewPending": require_int(
                item.get("independentVisualReviewPending"),
                "followup.independentVisualReviewPending",
            ),
        }
    if declared_map != followup_counts:
        raise SystemExit("effective-status openVisualFollowups does not match wave state")

    safety = summary.get("approvalSafety")
    if not isinstance(safety, dict):
        raise SystemExit("effective-status approvalSafety must be an object")
    for key in (
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "primaryReviewerMaySelfApprove",
        "growthDocumentMayBePromotedWithoutFormalPlanEvidence",
        "deepVerificationApproved",
    ):
        if safety.get(key) is not False:
            raise SystemExit(f"effective-status approvalSafety.{key} must be false")

    print(
        json.dumps(
            {
                "status": "ok",
                "waveCount": len(wave_paths),
                "overlayCount": len(overlay_paths),
                **aggregate,
                "deepVerificationApproved": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
