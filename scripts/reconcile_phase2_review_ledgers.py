#!/usr/bin/env python3
"""Reconcile Phase 2 wave ledgers with explicit review records.

This script does not create facts, reviews, independent-review decisions, or
approval. It only mirrors an already-completed primary review into the wave and
canonical status ledgers when all of the following already exist:

* a primary review whose status starts with ``primary_review_complete``;
* explicit full-text, metrics, and field-evidence validation flags;
* an independent-review packet whose status is ``independent_review_ready``;
* automatic approval and deep verification remain disabled.

Independent review completion and deep verification approval are never changed.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PHASE2 = ROOT / "operations" / "quality-rebase" / "phase2"
STATUS_PATH = PHASE2 / "current-status-v1.json"
WAVE_GLOB = "primary-review-wave*-v1.json"

ASSIGNED_STATUSES = {
    "primary_review_assigned",
    "primary_review_assigned_formal_plan_boundary_required",
}
COMPLETED_STATUS = "primary_review_complete_independent_review_ready"


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def dump(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def get_bool(record: dict[str, Any], *paths: tuple[str, ...]) -> bool:
    for path in paths:
        current: Any = record
        for key in path:
            if not isinstance(current, dict) or key not in current:
                current = None
                break
            current = current[key]
        if current is True:
            return True
    return False


def find_review_file(code: str) -> Path | None:
    path = PHASE2 / "reviews" / f"{code}-primary-review-v1.json"
    return path if path.is_file() else None


def find_independent_file(code: str) -> Path | None:
    path = PHASE2 / "independent" / f"{code}-independent-review-v1.json"
    return path if path.is_file() else None


def is_explicit_primary_completion(review: dict[str, Any], code: str) -> bool:
    company = review.get("company", {})
    state = review.get("review", {})
    if str(company.get("code")) != code:
        return False
    if not str(state.get("status", "")).startswith("primary_review_complete"):
        return False
    if state.get("automaticApprovalAllowed") is not False:
        return False
    if state.get("deepVerificationApproved") is not False:
        return False
    if not get_bool(
        review,
        ("validation", "fullTextHumanReviewComplete"),
        ("document", "fullTextHumanReviewComplete"),
        ("source", "fullTextHumanReviewComplete"),
    ):
        return False
    if not get_bool(
        review,
        ("validation", "metricsValidated"),
        ("validation", "metricsValidatedPrimaryPass"),
    ):
        return False
    if not get_bool(review, ("validation", "fieldLevelEvidenceLinked")):
        return False
    return True


def is_pending_independent_packet(packet: dict[str, Any], code: str) -> bool:
    if str(packet.get("company", {}).get("code")) != code:
        return False
    if packet.get("status") != "independent_review_ready":
        return False

    if "checks" in packet:
        checks = packet.get("checks")
        if not isinstance(checks, list) or not checks:
            return False
        if any(not isinstance(item, dict) or item.get("status") != "pending" for item in checks):
            return False
        review = packet.get("review", {})
        return (
            review.get("minimumDistinctReviewers", 0) >= 2
            and review.get("primaryReviewerMustNotSelfApprove") is True
            and review.get("automaticApprovalAllowed") is False
            and review.get("deepVerificationApproved") is False
            and review.get("completedAt") is None
            and review.get("reviewer") is None
        )

    if "requiredChecks" in packet:
        checks = packet.get("requiredChecks")
        if not isinstance(checks, list) or not checks:
            return False
        if any(not isinstance(item, dict) or item.get("completed") is not False for item in checks):
            return False
        independence = packet.get("independenceRequirement", {})
        return (
            independence.get("minimumDistinctReviewers", 0) >= 2
            and independence.get("reviewerMustDifferFromPrimaryReviewer") is True
            and independence.get("reviewerRecorded") is False
            and packet.get("automaticApprovalAllowed") is False
            and packet.get("deepVerificationApproved") is False
        )

    return False


def build_completed_checks(review: dict[str, Any], required: list[str]) -> list[str]:
    checks: list[str] = []

    def add(name: str) -> None:
        if name not in checks:
            checks.append(name)

    if get_bool(
        review,
        ("validation", "formalPlanConfirmed"),
        ("document", "formalPlanConfirmed"),
        ("source", "formalPlanConfirmed"),
    ):
        add("formalPlanConfirmation")
    if get_bool(review, ("validation", "formalPlanBoundaryValidated")):
        add("formalPlanBoundary")
    add("fullTextReview")
    if get_bool(review, ("validation", "visualFigureReviewComplete")):
        add("visualFigureReview")
    add("metricsValidation")
    if review.get("capitalPolicy") or review.get("structuredAnalysis", {}).get("capitalPolicy"):
        add("capitalPolicyReview")
    add("fieldLevelEvidence")
    if all(
        get_bool(review, ("validation", key))
        for key in ("yearValidated", "unitValidated", "scopeValidated")
    ):
        add("yearUnitScopeValidation")

    for required_check in required:
        if required_check == "growthPotentialDocumentSeparation" and get_bool(
            review, ("validation", "growthPotentialDocumentSeparated")
        ):
            add(required_check)
        if required_check == "sectionScopeValidation" and get_bool(
            review, ("validation", "sectionScopeValidated")
        ):
            add(required_check)

    return checks


def source_classification(review: dict[str, Any]) -> str:
    source = review.get("source", {})
    document = review.get("document", {})
    return str(
        source.get("documentClassification")
        or source.get("sourceClassification")
        or document.get("sourceClassification")
        or document.get("documentClassification")
        or "official_reviewed_source"
    )


def source_resolution_file(review: dict[str, Any]) -> str | None:
    source = review.get("source", {})
    for key in ("sourceCorrectionFile", "sourceResolutionFile"):
        value = source.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def reconcile_wave(path: Path) -> tuple[dict[str, Any], bool]:
    wave = load(path)
    changed = False
    completed = 0
    ready = 0

    companies = wave.get("companies", [])
    for company in companies:
        if not isinstance(company, dict):
            continue
        code = str(company.get("code", ""))
        status = str(company.get("status", ""))

        if status == COMPLETED_STATUS:
            completed += 1
            ready += 1
            continue
        if status not in ASSIGNED_STATUSES:
            continue

        review_path = find_review_file(code)
        independent_path = find_independent_file(code)
        if review_path is None or independent_path is None:
            continue

        review = load(review_path)
        packet = load(independent_path)
        if not is_explicit_primary_completion(review, code):
            continue
        if not is_pending_independent_packet(packet, code):
            continue

        company["reviewFile"] = str(review_path.relative_to(ROOT))
        company["independentReviewFile"] = str(independent_path.relative_to(ROOT))
        company["status"] = COMPLETED_STATUS
        company["completedChecks"] = build_completed_checks(
            review,
            list(company.get("requiredChecks", [])),
        )
        company["automaticApprovalAllowed"] = False
        company["deepVerificationApproved"] = False
        completed += 1
        ready += 1
        changed = True

    counts = wave.setdefault("counts", {})
    derived = {
        "primaryReviewComplete": completed,
        "independentReviewReady": ready,
        "deepVerificationApproved": 0,
    }
    for key, value in derived.items():
        if counts.get(key) != value:
            counts[key] = value
            changed = True

    if changed:
        wave["updatedAt"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        dump(path, wave)
    return wave, changed


def canonical_record(
    company: dict[str, Any], review: dict[str, Any]
) -> dict[str, Any]:
    code = str(company["code"])
    record: dict[str, Any] = {
        "order": company["order"],
        "code": code,
        "name": company["name"],
        "reviewFile": company["reviewFile"],
        "independentReviewFile": company["independentReviewFile"],
        "status": COMPLETED_STATUS,
        "sourceCorrectionRequired": False,
        "sourceClassification": source_classification(review),
    }
    resolution = source_resolution_file(review)
    if resolution:
        key = "sourceCorrectionFile" if "correction" in resolution else "sourceResolutionFile"
        record[key] = resolution
        record["sourceCorrectionRequired"] = True
    return record


def reconcile_status(waves: list[dict[str, Any]]) -> bool:
    status = load(STATUS_PATH)
    changed = False

    existing_records = {
        str(item.get("code")): item
        for item in status.get("completedPrimaryReviews", [])
        if isinstance(item, dict) and item.get("code") is not None
    }

    for wave in waves:
        for company in wave.get("companies", []):
            if not isinstance(company, dict) or company.get("status") != COMPLETED_STATUS:
                continue
            code = str(company["code"])
            review_path = ROOT / str(company["reviewFile"])
            review = load(review_path)
            new_record = canonical_record(company, review)
            old_record = existing_records.get(code)
            if old_record != new_record:
                existing_records[code] = new_record
                changed = True

    records = sorted(
        existing_records.values(),
        key=lambda item: (int(item.get("order", 10**9)), str(item.get("code", ""))),
    )
    if status.get("completedPrimaryReviews") != records:
        status["completedPrimaryReviews"] = records
        changed = True

    completed_total = len(records)
    independent_files = [
        str(item["independentReviewFile"])
        for item in records
        if isinstance(item.get("independentReviewFile"), str)
    ]
    review_state = status.setdefault("review", {})
    review_updates = {
        "sourceIdentityConfirmed": completed_total,
        "formalPlanConfirmed": completed_total,
        "primaryReviewComplete": completed_total,
        "primaryReviewWavesAssigned": len(waves),
        "primaryReviewCompaniesAssignedTotal": sum(
            len(wave.get("companies", [])) for wave in waves
        ),
        "independentReviewReady": len(independent_files),
        "independentReviewComplete": 0,
        "deepVerificationApproved": 0,
        "remainingPrimaryReviews": int(status.get("additionalCompaniesTarget", 450))
        - completed_total,
    }
    if waves:
        latest = sorted(waves, key=lambda wave: int(wave.get("wave", 0)))[-1]
        latest_path = PHASE2 / f"primary-review-wave{int(latest['wave']):02d}-v1.json"
        review_updates["primaryReviewWaveAssigned"] = int(latest.get("targetCompanies", 0))
        review_updates["primaryReviewWaveFile"] = str(latest_path.relative_to(ROOT))
        review_updates["primaryReviewWaveFiles"] = [
            str(
                (PHASE2 / f"primary-review-wave{int(wave['wave']):02d}-v1.json").relative_to(ROOT)
            )
            for wave in sorted(waves, key=lambda wave: int(wave.get("wave", 0)))
        ]

    for key, value in review_updates.items():
        if review_state.get(key) != value:
            review_state[key] = value
            changed = True

    active = status.setdefault("activeWork", [])
    active_by_name = {
        str(item.get("workstream")): item
        for item in active
        if isinstance(item, dict) and item.get("workstream")
    }
    for wave in waves:
        number = int(wave["wave"])
        name = f"primary_review_wave{number:02d}"
        assigned = len(wave.get("companies", []))
        complete = int(wave.get("counts", {}).get("primaryReviewComplete", 0))
        item = {
            "workstream": name,
            "companies": assigned,
            "status": "complete" if complete == assigned else "in_progress",
            "completionCount": complete,
            "remainingCount": assigned - complete,
            "file": str(
                (PHASE2 / f"primary-review-wave{number:02d}-v1.json").relative_to(ROOT)
            ),
        }
        if active_by_name.get(name) != item:
            active_by_name[name] = item
            changed = True

    queue_item = {
        "workstream": "independent_review_ready_queue",
        "companies": len(independent_files),
        "status": "ready",
        "completionCount": 0,
        "files": independent_files,
    }
    if active_by_name.get("independent_review_ready_queue") != queue_item:
        active_by_name["independent_review_ready_queue"] = queue_item
        changed = True

    ordered_names: list[str] = []
    for wave in sorted(waves, key=lambda wave: int(wave.get("wave", 0))):
        ordered_names.append(f"primary_review_wave{int(wave['wave']):02d}")
    ordered_names.append("independent_review_ready_queue")
    for item in active:
        if isinstance(item, dict):
            name = str(item.get("workstream", ""))
            if name and name not in ordered_names:
                ordered_names.append(name)
    new_active = [active_by_name[name] for name in ordered_names if name in active_by_name]
    if active != new_active:
        status["activeWork"] = new_active
        changed = True

    if status.get("automaticDeepApprovalAllowed") is not False:
        status["automaticDeepApprovalAllowed"] = False
        changed = True

    if changed:
        status["updatedAt"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        dump(STATUS_PATH, status)
    return changed


def main() -> None:
    wave_paths = sorted(PHASE2.glob(WAVE_GLOB))
    if not wave_paths:
        raise SystemExit("no Phase 2 wave files found")

    waves: list[dict[str, Any]] = []
    changed_paths: list[str] = []
    for path in wave_paths:
        wave, changed = reconcile_wave(path)
        waves.append(wave)
        if changed:
            changed_paths.append(str(path.relative_to(ROOT)))

    if reconcile_status(waves):
        changed_paths.append(str(STATUS_PATH.relative_to(ROOT)))

    print(
        json.dumps(
            {
                "status": "ok",
                "changed": changed_paths,
                "primaryReviewComplete": sum(
                    int(wave.get("counts", {}).get("primaryReviewComplete", 0))
                    for wave in waves
                ),
                "deepVerificationApproved": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
