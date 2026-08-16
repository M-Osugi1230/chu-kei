#!/usr/bin/env python3
"""Validate the Phase 2 primary-review ledger across all historical overlay formats.

This gate intentionally validates company-level evidence instead of replaying old
aggregate status mutations. Phase 2 has used several append-only overlay formats
over time; the stable counting unit is a unique company code with a canonical
primary-review artifact.

The validator checks:
- every assignment wave is structurally safe,
- canonical review artifacts have stable company identities,
- every completion overlay is safety-locked,
- row-bearing overlays point to matching, existing review artifacts,
- completion rows belong to the declared wave assignment,
- batch completion rows are unique within a wave,
- final/aggregate completion counts do not exceed wave assignments,
- the authoritative effective-status count equals the canonical review count,
- the remaining count equals target minus canonical review count.

It never mutates review state and never promotes Deep Verification.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

CODE_PATTERN = re.compile(r"^(?:\d{4}|\d{3}[A-Z])$")
WAVE_FILE_PATTERN = re.compile(r"primary-review-wave(?P<wave>\d+)-v1\.json$")
REVIEW_FILE_PATTERN = re.compile(
    r"^(?P<code>(?:\d{4}|\d{3}[A-Z]))(?:-wave\d+)?-primary-review-v\d+\.json$"
)
FORBIDDEN_TRUE_KEYS = {
    "automaticFactCompletionAllowed",
    "automaticApprovalAllowed",
    "deepVerificationApproved",
}
SUPPORTED_OVERLAY_SCHEMAS = {
    "phase2-review-state-overlay-v1",
    "quality-rebase-phase2-review-state-overlay-v1",
    "phase2-primary-review-completion-overlay-v1",
    "quality-rebase-phase2-primary-review-completion-overlay-v1",
    "phase2-primary-completion-overlay-v1",
    "quality-rebase-phase2-primary-completion-overlay-v1",
}


def die(message: str) -> None:
    raise SystemExit(message)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"missing file: {path}")
    except json.JSONDecodeError as exc:
        die(f"invalid JSON: {path}: {exc}")


def code_of(value: Any) -> str | None:
    if value is None:
        return None
    code = str(value).strip()
    return code if CODE_PATTERN.fullmatch(code) else None


def assert_no_forbidden_true(value: Any, location: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            child_location = f"{location}.{key}"
            if key in FORBIDDEN_TRUE_KEYS and child is True:
                die(f"{child_location} must not be true")
            assert_no_forbidden_true(child, child_location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_true(child, f"{location}[{index}]")


def require_false_safety(payload: dict[str, Any], path: Path) -> None:
    assert_no_forbidden_true(payload, str(path))
    safety = payload.get("safety")
    if isinstance(safety, dict):
        for key in FORBIDDEN_TRUE_KEYS:
            if key in safety and safety[key] is not False:
                die(f"{path}: safety.{key} must be false when present")
    safeguards = payload.get("safeguards")
    if isinstance(safeguards, dict):
        for key in FORBIDDEN_TRUE_KEYS:
            if key in safeguards and safeguards[key] is not False:
                die(f"{path}: safeguards.{key} must be false when present")
    for key in FORBIDDEN_TRUE_KEYS:
        if key in payload and payload[key] is not False:
            die(f"{path}: {key} must be false when present")


def load_waves(phase2: Path) -> dict[int, dict[str, Any]]:
    waves: dict[int, dict[str, Any]] = {}
    for path in sorted(phase2.glob("primary-review-wave*-v1.json")):
        match = WAVE_FILE_PATTERN.fullmatch(path.name)
        if not match:
            continue
        wave_number = int(match.group("wave"))
        payload = load_json(path)
        if not isinstance(payload, dict):
            die(f"{path}: wave must be an object")
        if payload.get("wave") != wave_number:
            die(f"{path}: filename/payload wave mismatch")
        require_false_safety(payload, path)

        companies = payload.get("companies")
        if not isinstance(companies, list) or not companies:
            die(f"{path}: companies must be a non-empty array")

        seen_codes: set[str] = set()
        for index, company in enumerate(companies):
            if not isinstance(company, dict):
                die(f"{path}: companies[{index}] must be an object")
            code = code_of(company.get("code"))
            if code is None:
                die(f"{path}: companies[{index}] has invalid company code")
            if code in seen_codes:
                die(f"{path}: duplicate company code within wave: {code}")
            seen_codes.add(code)
            if not str(company.get("name", "")).strip():
                die(f"{path}: company {code} lacks name")

        counts = payload.get("counts")
        if isinstance(counts, dict):
            assigned = counts.get("assigned")
            if isinstance(assigned, int) and assigned != len(companies):
                die(
                    f"{path}: counts.assigned={assigned} "
                    f"does not match companies={len(companies)}"
                )
            if counts.get("deepVerificationApproved") not in (None, 0):
                die(f"{path}: Deep Verification must remain unapproved")

        target = payload.get("targetCompanies")
        if isinstance(target, int) and target != len(companies):
            die(
                f"{path}: targetCompanies={target} "
                f"does not match companies={len(companies)}"
            )

        if wave_number in waves:
            die(f"duplicate wave number: {wave_number}")
        waves[wave_number] = {"path": path, "payload": payload, "codes": seen_codes}

    if not waves:
        die("no Phase 2 primary-review waves found")
    return waves


def extract_review_identity(payload: Any, path: Path) -> str:
    if not isinstance(payload, dict):
        die(f"{path}: review artifact must be an object")
    company = payload.get("company")
    code = code_of(company.get("code")) if isinstance(company, dict) else None
    if code is None:
        code = code_of(payload.get("companyCode"))
    filename_match = REVIEW_FILE_PATTERN.fullmatch(path.name)
    filename_code = filename_match.group("code") if filename_match else None
    if code is None:
        code = filename_code
    if code is None:
        die(f"{path}: cannot determine review company code")
    if filename_code is not None and filename_code != code:
        die(f"{path}: filename company code {filename_code} != payload {code}")
    require_false_safety(payload, path)
    return code


def canonical_reviews(repo_root: Path, phase2: Path) -> tuple[set[str], dict[str, list[Path]]]:
    codes: set[str] = set()
    files: dict[str, list[Path]] = defaultdict(list)
    for directory_name in ("primary-reviews", "reviews"):
        directory = phase2 / directory_name
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*-primary-review-v*.json")):
            payload = load_json(path)
            code = extract_review_identity(payload, path)
            codes.add(code)
            files[code].append(path.relative_to(repo_root))
    if not codes:
        die("no canonical Phase 2 primary-review artifacts found")
    return codes, dict(files)


def completion_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("completed", "companyCompletions", "overlays"):
        rows = payload.get(key)
        if isinstance(rows, list) and rows and all(isinstance(row, dict) for row in rows):
            return rows
    return []


def declared_review_file(row: dict[str, Any]) -> str | None:
    for key in ("reviewFile", "primaryReviewFile"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def row_status_is_safe(row: dict[str, Any], path: Path, code: str) -> None:
    assert_no_forbidden_true(row, f"{path}:{code}")
    if row.get("independentVisualReviewPending") is False:
        ready = row.get("independentReviewReady")
        if ready is not True:
            die(
                f"{path}: {code} clears independentVisualReviewPending "
                "without explicit independentReviewReady"
            )


def validate_declared_review_path(
    repo_root: Path,
    review_path_text: str,
    code: str,
    overlay_path: Path,
) -> None:
    review_path = repo_root / review_path_text
    if not review_path.is_file():
        die(f"{overlay_path}: declared review file does not exist: {review_path_text}")
    review_payload = load_json(review_path)
    review_code = extract_review_identity(review_payload, review_path)
    if review_code != code:
        die(
            f"{overlay_path}: completion {code} points to review for {review_code}: "
            f"{review_path_text}"
        )


def latest_numeric_count(payload: dict[str, Any]) -> tuple[int | None, int | None]:
    """Return wave-local (primary_complete, remaining) where available."""
    counts = payload.get("counts")
    effective = payload.get("effectiveCounts")

    primary: int | None = None
    remaining: int | None = None

    if isinstance(effective, dict):
        for key in ("wavePrimaryReviewComplete", "primaryReviewComplete"):
            value = effective.get(key)
            if isinstance(value, int):
                primary = value
                break
        for key in ("remaining", "waveRemaining"):
            value = effective.get(key)
            if isinstance(value, int):
                remaining = value
                break

    if primary is None and isinstance(counts, dict):
        value = counts.get("primaryReviewComplete")
        if isinstance(value, int):
            primary = value
    if remaining is None and isinstance(counts, dict):
        value = counts.get("remaining")
        if isinstance(value, int):
            remaining = value

    if primary is None:
        value = payload.get("primaryReviewComplete")
        if isinstance(value, int):
            primary = value
    if remaining is None:
        value = payload.get("remaining")
        if isinstance(value, int):
            remaining = value
    return primary, remaining


def validate_overlays(
    repo_root: Path,
    phase2: Path,
    waves: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    overlay_dir = phase2 / "review-state-overlays"
    if not overlay_dir.exists():
        die("review-state-overlays directory is missing")

    files = sorted(overlay_dir.glob("wave*-primary-completion*.json"))
    if not files:
        die("no primary completion overlays found")

    rows_by_wave: dict[int, set[str]] = defaultdict(set)
    overlay_files_by_wave: dict[int, list[str]] = defaultdict(list)
    latest_counts: dict[int, tuple[int | None, int | None]] = {}
    row_count = 0

    for path in files:
        payload = load_json(path)
        if not isinstance(payload, dict):
            die(f"{path}: overlay must be an object")
        schema = payload.get("schemaVersion")
        if schema not in SUPPORTED_OVERLAY_SCHEMAS:
            die(f"{path}: unsupported overlay schema: {schema!r}")
        require_false_safety(payload, path)

        wave = payload.get("wave")
        if not isinstance(wave, int) or wave not in waves:
            die(f"{path}: overlay refers to unknown wave {wave!r}")
        overlay_files_by_wave[wave].append(str(path.relative_to(repo_root)))

        rows = completion_rows(payload)
        for index, row in enumerate(rows):
            code = code_of(row.get("code"))
            if code is None:
                die(f"{path}: completion row {index} has invalid company code")
            if code not in waves[wave]["codes"]:
                die(f"{path}: completion {code} is not assigned to wave {wave}")
            if code in rows_by_wave[wave]:
                die(f"{path}: duplicate completion row for {code} in wave {wave}")
            rows_by_wave[wave].add(code)
            row_count += 1
            row_status_is_safe(row, path, code)

            review_file = declared_review_file(row)
            if review_file is not None:
                validate_declared_review_path(repo_root, review_file, code, path)

        primary, remaining = latest_numeric_count(payload)
        previous = latest_counts.get(wave)
        if previous is None:
            latest_counts[wave] = (primary, remaining)
        else:
            prev_primary, prev_remaining = previous
            if primary is not None and prev_primary is not None and primary < prev_primary:
                die(f"{path}: primary completion count regressed within wave {wave}")
            if remaining is not None and prev_remaining is not None and remaining > prev_remaining:
                die(f"{path}: remaining count increased within wave {wave}")
            latest_counts[wave] = (
                primary if primary is not None else prev_primary,
                remaining if remaining is not None else prev_remaining,
            )

    for wave, (primary, remaining) in latest_counts.items():
        assigned = len(waves[wave]["codes"])
        if primary is not None and not (0 <= primary <= assigned):
            die(
                f"wave {wave}: overlay primaryReviewComplete={primary} "
                f"outside assigned range 0..{assigned}"
            )
        if remaining is not None and not (0 <= remaining <= assigned):
            die(
                f"wave {wave}: overlay remaining={remaining} "
                f"outside assigned range 0..{assigned}"
            )
        if primary is not None and remaining is not None and primary + remaining != assigned:
            die(
                f"wave {wave}: primaryReviewComplete({primary}) + "
                f"remaining({remaining}) != assigned({assigned})"
            )

    return {
        "overlayFiles": len(files),
        "rowBearingCompletions": row_count,
        "overlayWaves": sorted(overlay_files_by_wave),
        "rowCodesByWave": {wave: sorted(codes) for wave, codes in rows_by_wave.items()},
    }


def validate_effective_status(
    phase2: Path,
    canonical_codes: set[str],
) -> dict[str, int]:
    path = phase2 / "effective-status-v1.json"
    payload = load_json(path)
    if not isinstance(payload, dict):
        die(f"{path}: effective status must be an object")
    require_false_safety(payload, path)

    targets = payload.get("targets")
    review = payload.get("review")
    reconciliation = payload.get("reconciliation")
    if not isinstance(targets, dict) or not isinstance(review, dict):
        die(f"{path}: missing targets/review objects")

    target = targets.get("phase2Additional")
    declared = review.get("phase2PrimaryReviewComplete")
    remaining = review.get("remainingPhase2PrimaryReviews")
    if not all(isinstance(value, int) for value in (target, declared, remaining)):
        die(f"{path}: Phase 2 target/complete/remaining must be integers")

    canonical = len(canonical_codes)
    if declared != canonical:
        die(
            f"{path}: declared Phase 2 complete {declared} "
            f"!= canonical review artifacts {canonical}"
        )
    if remaining != target - canonical:
        die(
            f"{path}: remaining {remaining} "
            f"!= target({target}) - canonical({canonical})"
        )

    phase1 = review.get("phase1PrimaryReviewComplete")
    total = review.get("primaryReviewCompleteIncludingPhase1")
    if isinstance(phase1, int) and isinstance(total, int) and total != phase1 + canonical:
        die(
            f"{path}: total primary review complete {total} "
            f"!= Phase1({phase1}) + Phase2 canonical({canonical})"
        )

    if isinstance(reconciliation, dict):
        reconciled = reconciliation.get("canonicalPhase2PrimaryReviewArtifacts")
        if isinstance(reconciled, int) and reconciled != canonical:
            die(
                f"{path}: reconciliation canonical count {reconciled} "
                f"!= discovered canonical count {canonical}"
            )
        if reconciliation.get("companyCodeIsCountingUnit") is not True:
            die(f"{path}: companyCodeIsCountingUnit must be true")
        if reconciliation.get("automaticCountInflationForbidden") is not True:
            die(f"{path}: automaticCountInflationForbidden must be true")

    return {
        "target": target,
        "canonicalComplete": canonical,
        "remaining": remaining,
        "phase1Complete": phase1 if isinstance(phase1, int) else 0,
        "totalComplete": total if isinstance(total, int) else canonical,
    }


def assigned_codes(waves: dict[int, dict[str, Any]]) -> set[str]:
    result: set[str] = set()
    for item in waves.values():
        result.update(item["codes"])
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    phase2 = repo_root / "operations" / "quality-rebase" / "phase2"

    waves = load_waves(phase2)
    canonical_codes, canonical_files = canonical_reviews(repo_root, phase2)
    overlay_summary = validate_overlays(repo_root, phase2, waves)
    status_summary = validate_effective_status(phase2, canonical_codes)

    assigned = assigned_codes(waves)
    unassigned_canonical = sorted(canonical_codes - assigned)

    summary = {
        "status": "ok",
        "waveCount": len(waves),
        "firstWave": min(waves),
        "latestWave": max(waves),
        "historicalAssignmentRows": sum(len(item["codes"]) for item in waves.values()),
        "historicallyAssignedUniqueCompanies": len(assigned),
        "canonicalReviewsWithoutHistoricalAssignment": len(unassigned_canonical),
        "canonicalPrimaryReviewCompanies": len(canonical_codes),
        "canonicalPrimaryReviewFiles": sum(len(paths) for paths in canonical_files.values()),
        **overlay_summary,
        **status_summary,
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": False,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
