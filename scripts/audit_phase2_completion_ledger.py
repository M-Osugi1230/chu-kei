#!/usr/bin/env python3
"""Audit Phase 2 completion aggregates against company-level evidence.

This audit compares:
- canonical primary-review artifacts,
- primary-completion overlays,
- historical wave assignments, and
- the effective aggregate status.

No review or approval state is mutated. The output is a diagnostic ledger used
to repair aggregate counters without inventing completion evidence.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PHASE2 = ROOT / "operations" / "quality-rebase" / "phase2"
OVERLAYS = PHASE2 / "review-state-overlays"
REVIEW_DIRS = [PHASE2 / "primary-reviews", PHASE2 / "reviews"]
EFFECTIVE_STATUS = PHASE2 / "effective-status-v1.json"
OUTPUT = PHASE2 / "completion-ledger-audit-v1.json"
CODE_PATTERN = re.compile(r"^(?:\d{4}|\d{3}[A-Z])$")
REVIEW_FILE_PATTERN = re.compile(
    r"^(?P<code>(?:\d{4}|\d{3}[A-Z]))(?:-wave\d+)?-primary-review-v\d+\.json$"
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def code_of(value: Any) -> str | None:
    if value is None:
        return None
    code = str(value).strip()
    return code if CODE_PATTERN.fullmatch(code) else None


def review_codes() -> tuple[set[str], dict[str, list[str]]]:
    codes: set[str] = set()
    files: dict[str, list[str]] = defaultdict(list)
    for directory in REVIEW_DIRS:
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.json")):
            filename_match = REVIEW_FILE_PATTERN.fullmatch(path.name)
            filename_code = filename_match.group("code") if filename_match else None
            try:
                payload = load_json(path)
            except (OSError, json.JSONDecodeError):
                payload = None
            company = payload.get("company") if isinstance(payload, dict) else None
            json_code = code_of(company.get("code")) if isinstance(company, dict) else None
            if filename_code and json_code and filename_code != json_code:
                raise SystemExit(f"review identity mismatch: {path}: {filename_code} != {json_code}")
            code = json_code or filename_code
            if code is None:
                continue
            codes.add(code)
            files[code].append(str(path.relative_to(ROOT)))
    return codes, dict(files)


def overlay_entries() -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    rows: list[dict[str, Any]] = []
    evidence: dict[str, list[str]] = defaultdict(list)
    if not OVERLAYS.exists():
        return rows, {}
    for path in sorted(OVERLAYS.glob("*primary-completion*.json")):
        try:
            payload = load_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        wave = payload.get("wave")
        completed = payload.get("completed")
        if not isinstance(completed, list):
            continue
        for item in completed:
            if not isinstance(item, dict):
                continue
            code = code_of(item.get("code"))
            if code is None:
                continue
            row = {
                "code": code,
                "name": item.get("name"),
                "wave": wave,
                "overlayFile": str(path.relative_to(ROOT)),
                "reviewFileDeclared": item.get("reviewFile"),
            }
            rows.append(row)
            evidence[code].append(str(path.relative_to(ROOT)))
    return rows, dict(evidence)


def assignment_codes() -> dict[str, list[int]]:
    assigned: dict[str, list[int]] = defaultdict(list)
    for path in sorted(PHASE2.glob("primary-review-wave*-v1.json")):
        try:
            payload = load_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        wave = payload.get("wave")
        if not isinstance(wave, int):
            match = re.search(r"wave(\d+)", path.name)
            wave = int(match.group(1)) if match else -1
        companies = payload.get("companies")
        if not isinstance(companies, list):
            continue
        for item in companies:
            if not isinstance(item, dict):
                continue
            code = code_of(item.get("code"))
            if code is not None:
                assigned[code].append(wave)
    return {code: sorted(waves) for code, waves in assigned.items()}


def effective_count() -> int | None:
    if not EFFECTIVE_STATUS.exists():
        return None
    payload = load_json(EFFECTIVE_STATUS)
    review = payload.get("review") if isinstance(payload, dict) else None
    value = review.get("phase2PrimaryReviewComplete") if isinstance(review, dict) else None
    return value if isinstance(value, int) else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    artifacts, artifact_files = review_codes()
    overlay_rows, overlay_files = overlay_entries()
    assigned = assignment_codes()
    declared = effective_count()

    overlay_code_counts = Counter(row["code"] for row in overlay_rows)
    overlay_unique = set(overlay_code_counts)
    duplicate_overlay_codes = sorted(code for code, count in overlay_code_counts.items() if count > 1)
    overlay_missing_artifact = sorted(overlay_unique - artifacts)
    artifact_missing_overlay = sorted(artifacts - overlay_unique)
    assigned_without_artifact = sorted(set(assigned) - artifacts)
    unassigned_artifacts = sorted(artifacts - set(assigned))

    duplicate_details = [
        {
            "code": code,
            "occurrences": overlay_code_counts[code],
            "overlayFiles": overlay_files.get(code, []),
            "reviewFiles": artifact_files.get(code, []),
            "waveAssignments": assigned.get(code, []),
        }
        for code in duplicate_overlay_codes
    ]

    missing_details = [
        {
            "code": code,
            "overlayFiles": overlay_files.get(code, []),
            "waveAssignments": assigned.get(code, []),
        }
        for code in overlay_missing_artifact
    ]

    output = {
        "schemaVersion": "phase2-completion-ledger-audit-v1",
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "counts": {
            "effectiveStatusDeclaredComplete": declared,
            "canonicalPrimaryReviewArtifacts": len(artifacts),
            "completionOverlayRows": len(overlay_rows),
            "completionOverlayUniqueCompanies": len(overlay_unique),
            "duplicateCompletionOverlayCodes": len(duplicate_overlay_codes),
            "overlayCompleteWithoutReviewArtifact": len(overlay_missing_artifact),
            "reviewArtifactWithoutCompletionOverlay": len(artifact_missing_overlay),
            "historicallyAssignedUniqueCompanies": len(assigned),
            "assignedWithoutReviewArtifact": len(assigned_without_artifact),
            "reviewArtifactWithoutHistoricalAssignment": len(unassigned_artifacts),
            "declaredMinusCanonicalArtifactGap": (
                declared - len(artifacts) if isinstance(declared, int) else None
            ),
        },
        "duplicateCompletionOverlayCodes": duplicate_details,
        "overlayCompleteWithoutReviewArtifact": missing_details,
        "reviewArtifactWithoutCompletionOverlay": [
            {"code": code, "reviewFiles": artifact_files.get(code, []), "waveAssignments": assigned.get(code, [])}
            for code in artifact_missing_overlay
        ],
        "assignedWithoutReviewArtifact": [
            {"code": code, "waveAssignments": assigned.get(code, [])}
            for code in assigned_without_artifact
        ],
        "reviewArtifactWithoutHistoricalAssignment": [
            {"code": code, "reviewFiles": artifact_files.get(code, [])}
            for code in unassigned_artifacts
        ],
        "repairPolicy": {
            "canonicalReviewArtifactRequiredForCompletion": True,
            "duplicateOverlayRowsCountOncePerCompany": True,
            "assignmentAloneDoesNotEqualCompletion": True,
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
        },
    }

    if args.write:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(output["counts"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
