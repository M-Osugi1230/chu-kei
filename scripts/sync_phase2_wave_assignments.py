#!/usr/bin/env python3
"""Synchronize Phase 2 assignment metadata from explicit wave files.

This script updates assignment-only fields in the canonical Phase 2 status. It
never creates reviews, never changes completed-review records, and never grants
independent or deep-verification approval.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PHASE2_DIR = Path("operations/quality-rebase/phase2")
ASSIGNED_STATUSES = {
    "primary_review_assigned",
    "primary_review_assigned_formal_plan_boundary_required",
}
COMPLETED_STATUS = "primary_review_complete_independent_review_ready"
FORBIDDEN_TRUE_KEYS = {
    "automaticFactCompletionAllowed",
    "automaticApprovalAllowed",
    "automaticDeepApprovalAllowed",
    "deepVerificationApproved",
}


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"top-level JSON must be an object: {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def assert_no_forbidden_true(value: Any, location: str = "root") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            child_location = f"{location}.{key}"
            if key in FORBIDDEN_TRUE_KEYS and child is True:
                raise SystemExit(f"forbidden true flag at {child_location}")
            assert_no_forbidden_true(child, child_location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_true(child, f"{location}[{index}]")


def load_waves(repo_root: Path) -> list[tuple[Path, dict[str, Any]]]:
    phase2_dir = repo_root / PHASE2_DIR
    wave_paths = sorted(phase2_dir.glob("primary-review-wave*-v1.json"))
    if not wave_paths:
        raise SystemExit("no Phase 2 wave files found")

    waves: list[tuple[Path, dict[str, Any]]] = []
    seen_numbers: set[int] = set()
    seen_codes: set[str] = set()
    seen_orders: set[int] = set()

    for path in wave_paths:
        wave = load_json(path)
        if wave.get("schemaVersion") != "phase2-primary-review-wave-v1":
            raise SystemExit(f"unexpected wave schema: {path}")
        number = wave.get("wave")
        companies = wave.get("companies")
        target = wave.get("targetCompanies")
        if not isinstance(number, int) or number <= 0 or number in seen_numbers:
            raise SystemExit(f"invalid or duplicate wave number: {path}")
        if not isinstance(companies, list) or not isinstance(target, int):
            raise SystemExit(f"invalid wave companies or target: {path}")
        if len(companies) != target:
            raise SystemExit(f"wave target mismatch: {path}")

        completed = 0
        for company in companies:
            if not isinstance(company, dict):
                raise SystemExit(f"invalid company entry: {path}")
            code = str(company.get("code", "")).strip()
            order = company.get("order")
            status = company.get("status")
            if not code or not isinstance(order, int):
                raise SystemExit(f"wave company lacks code or order: {path}")
            if code in seen_codes or order in seen_orders:
                raise SystemExit(f"duplicate assignment detected: {code}/{order}")
            if status not in ASSIGNED_STATUSES | {COMPLETED_STATUS}:
                raise SystemExit(f"unsupported wave status for {code}: {status}")
            if status == COMPLETED_STATUS:
                completed += 1
            seen_codes.add(code)
            seen_orders.add(order)

        counts = wave.get("counts")
        if not isinstance(counts, dict):
            raise SystemExit(f"wave counts missing: {path}")
        if counts.get("assigned") != target:
            raise SystemExit(f"wave assigned count mismatch: {path}")
        if counts.get("primaryReviewComplete") != completed:
            raise SystemExit(f"wave completion count mismatch: {path}")
        if counts.get("deepVerificationApproved") != 0:
            raise SystemExit(f"wave approval count must remain zero: {path}")

        assert_no_forbidden_true(wave, str(path))
        seen_numbers.add(number)
        waves.append((path, wave))

    waves.sort(key=lambda item: item[1]["wave"])
    expected = list(range(1, len(waves) + 1))
    actual = [wave["wave"] for _, wave in waves]
    if actual != expected:
        raise SystemExit(f"wave numbers must be contiguous: {actual}")
    return waves


def synchronize(repo_root: Path, check: bool) -> dict[str, Any]:
    status_path = repo_root / PHASE2_DIR / "current-status-v1.json"
    status = load_json(status_path)
    waves = load_waves(repo_root)

    if status.get("automaticDeepApprovalAllowed") is not False:
        raise SystemExit("canonical status must prohibit automatic deep approval")

    completed_records = status.get("completedPrimaryReviews")
    if not isinstance(completed_records, list):
        raise SystemExit("completedPrimaryReviews must be an array")
    completed_count_before = len(completed_records)
    independent_complete_before = status.get("review", {}).get("independentReviewComplete")
    deep_approved_before = status.get("review", {}).get("deepVerificationApproved")

    review = status.get("review")
    if not isinstance(review, dict):
        raise SystemExit("review section missing")

    wave_files = [str(path.relative_to(repo_root)) for path, _ in waves]
    assigned_total = sum(wave["targetCompanies"] for _, wave in waves)
    latest_path, latest_wave = waves[-1]

    review["primaryReviewWaveAssigned"] = latest_wave["targetCompanies"]
    review["primaryReviewWavesAssigned"] = len(waves)
    review["primaryReviewCompaniesAssignedTotal"] = assigned_total
    review["primaryReviewWaveFile"] = str(latest_path.relative_to(repo_root))
    review["primaryReviewWaveFiles"] = wave_files

    active_work = status.get("activeWork")
    if not isinstance(active_work, list):
        raise SystemExit("activeWork must be an array")

    non_wave_items = [
        item
        for item in active_work
        if not (
            isinstance(item, dict)
            and str(item.get("workstream", "")).startswith("primary_review_wave")
        )
    ]
    wave_items: list[dict[str, Any]] = []
    for path, wave in waves:
        completed = wave["counts"]["primaryReviewComplete"]
        assigned = wave["counts"]["assigned"]
        wave_items.append(
            {
                "workstream": f"primary_review_wave{wave['wave']:02d}",
                "companies": assigned,
                "status": "complete" if completed == assigned else "in_progress",
                "completionCount": completed,
                "remainingCount": assigned - completed,
                "file": str(path.relative_to(repo_root)),
            }
        )
    status["activeWork"] = wave_items + non_wave_items
    status["updatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    if len(status.get("completedPrimaryReviews", [])) != completed_count_before:
        raise SystemExit("assignment synchronization changed completed reviews")
    if review.get("independentReviewComplete") != independent_complete_before:
        raise SystemExit("assignment synchronization changed independent completion")
    if review.get("deepVerificationApproved") != deep_approved_before:
        raise SystemExit("assignment synchronization changed deep approval")
    assert_no_forbidden_true(status)

    if not check:
        write_json(status_path, status)

    return {
        "status": "ok",
        "mode": "check" if check else "write",
        "waveCount": len(waves),
        "assignedCompaniesTotal": assigned_total,
        "latestWave": latest_wave["wave"],
        "latestWaveAssigned": latest_wave["targetCompanies"],
        "completedPrimaryReviewsUnchanged": completed_count_before,
        "independentReviewCompleteUnchanged": independent_complete_before,
        "deepVerificationApprovedUnchanged": deep_approved_before,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    result = synchronize(Path(args.repo_root).resolve(), args.check)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
