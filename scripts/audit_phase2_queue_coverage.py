#!/usr/bin/env python3
"""Audit Phase 2 current source-relevance queues against canonical reviews.

The current source-relevance audit partitions 450 collection targets into one
normal primary-review queue plus four exception queues. This script reconciles
those 450 codes with canonical Phase 2 review artifacts, Phase 1 cohort codes,
and historical assignments so the remaining workload is company-level evidence,
not an arithmetic remainder.
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
QUALITY = ROOT / "operations" / "quality-rebase"
PHASE2 = QUALITY / "phase2"
AUDIT_DIR = PHASE2 / "source-relevance-audit"
PHASE1_COHORT = QUALITY / "phase1-cohort-50-v1.json"
OUTPUT = PHASE2 / "queue-coverage-audit-v1.json"
CODE_PATTERN = re.compile(r"^(?:\d{4}|\d{3}[A-Z])$")
REVIEW_PATTERN = re.compile(r"^(?P<code>(?:\d{4}|\d{3}[A-Z]))(?:-wave\d+)?-primary-review-v\d+\.json$")

QUEUE_FILES = {
    "primary_review_candidate": AUDIT_DIR / "primary-review-candidates.json",
    "manual_source_relevance_check": AUDIT_DIR / "manual-source-relevance-check.json",
    "pdf_identification_required": AUDIT_DIR / "pdf-identification-required.json",
    "probable_wrong_document": AUDIT_DIR / "probable-wrong-document.json",
    "source_recovery_required": AUDIT_DIR / "source-recovery-required.json",
}
EXPECTED_COUNTS = {
    "primary_review_candidate": 357,
    "manual_source_relevance_check": 19,
    "pdf_identification_required": 14,
    "probable_wrong_document": 8,
    "source_recovery_required": 52,
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def code_of(value: Any) -> str | None:
    if value is None:
        return None
    code = str(value).strip()
    return code if CODE_PATTERN.fullmatch(code) else None


def queue_rows() -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    rows: dict[str, dict[str, Any]] = {}
    counts: dict[str, int] = {}
    for queue, path in QUEUE_FILES.items():
        payload = load_json(path)
        companies = payload.get("companies") if isinstance(payload, dict) else None
        if not isinstance(companies, list):
            raise SystemExit(f"missing companies list: {path}")
        counts[queue] = len(companies)
        for item in companies:
            if not isinstance(item, dict):
                continue
            code = code_of(item.get("code"))
            if code is None:
                raise SystemExit(f"invalid code in {path}: {item.get('code')!r}")
            if code in rows:
                raise SystemExit(f"current queue overlap: {code}")
            rows[code] = {
                "code": code,
                "name": item.get("name"),
                "queue": queue,
                "relevanceScore": item.get("relevanceScore"),
                "documentTypeCandidate": item.get("documentTypeCandidate"),
                "sourceUrl": item.get("sourceUrl"),
            }
    if counts != EXPECTED_COUNTS:
        raise SystemExit(f"unexpected current queue counts: {counts}")
    if len(rows) != 450:
        raise SystemExit(f"current queues must partition 450 unique codes, found {len(rows)}")
    return rows, counts


def canonical_reviews() -> tuple[set[str], dict[str, list[str]]]:
    codes: set[str] = set()
    files: dict[str, list[str]] = defaultdict(list)
    for directory in [PHASE2 / "primary-reviews", PHASE2 / "reviews"]:
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.json")):
            match = REVIEW_PATTERN.fullmatch(path.name)
            filename_code = match.group("code") if match else None
            try:
                payload = load_json(path)
            except (OSError, json.JSONDecodeError):
                payload = None
            company = payload.get("company") if isinstance(payload, dict) else None
            json_code = code_of(company.get("code")) if isinstance(company, dict) else None
            if filename_code and json_code and filename_code != json_code:
                raise SystemExit(f"review identity mismatch: {path}")
            code = json_code or filename_code
            if code is not None:
                codes.add(code)
                files[code].append(str(path.relative_to(ROOT)))
    return codes, dict(files)


def phase1_codes() -> set[str]:
    payload = load_json(PHASE1_COHORT)
    candidates: list[Any] = []
    if isinstance(payload, dict):
        for key in ("companies", "cohort", "selected", "records"):
            value = payload.get(key)
            if isinstance(value, list):
                candidates = value
                break
    codes: set[str] = set()
    for item in candidates:
        if isinstance(item, dict):
            code = code_of(item.get("code") or item.get("securityCode"))
        else:
            code = code_of(item)
        if code is not None:
            codes.add(code)
    if len(codes) != 50:
        raise SystemExit(f"expected 50 Phase1 codes, found {len(codes)}")
    return codes


def assignments() -> dict[str, list[int]]:
    out: dict[str, list[int]] = defaultdict(list)
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
                out[code].append(wave)
    return {code: sorted(waves) for code, waves in out.items()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    queues, queue_counts = queue_rows()
    reviews, review_files = canonical_reviews()
    phase1 = phase1_codes()
    assigned = assignments()

    audit_codes = set(queues)
    reviewed_in_audit = audit_codes & reviews
    remaining_in_audit = audit_codes - reviews
    artifacts_outside_audit = reviews - audit_codes
    phase1_overlap = audit_codes & phase1

    reviewed_by_queue = Counter(queues[code]["queue"] for code in reviewed_in_audit)
    remaining_by_queue = Counter(queues[code]["queue"] for code in remaining_in_audit)
    phase1_by_queue = Counter(queues[code]["queue"] for code in phase1_overlap)

    normal_missing = sorted(
        code for code in remaining_in_audit
        if queues[code]["queue"] == "primary_review_candidate"
    )
    normal_missing_rows = [
        {
            **queues[code],
            "phase1Overlap": code in phase1,
            "previousWaveAssignments": assigned.get(code, []),
            "requiredAction": (
                "exclude_from_phase2_if_phase1_duplicate"
                if code in phase1
                else "complete_primary_review_from_existing_review_input"
            ),
        }
        for code in normal_missing
    ]

    exception_missing = sorted(
        code for code in remaining_in_audit
        if queues[code]["queue"] != "primary_review_candidate"
    )

    output = {
        "schemaVersion": "phase2-queue-coverage-audit-v1",
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "counts": {
            "currentAuditUniqueCompanies": len(audit_codes),
            "canonicalPhase2PrimaryReviewArtifacts": len(reviews),
            "reviewedWithinCurrentAudit": len(reviewed_in_audit),
            "remainingWithinCurrentAudit": len(remaining_in_audit),
            "reviewArtifactsOutsideCurrentAudit": len(artifacts_outside_audit),
            "phase1OverlapWithinCurrentAudit": len(phase1_overlap),
            "normalPrimaryCandidatesRemaining": len(normal_missing),
            "exceptionCandidatesRemaining": len(exception_missing),
            "reviewedByQueue": dict(sorted(reviewed_by_queue.items())),
            "remainingByQueue": dict(sorted(remaining_by_queue.items())),
            "phase1OverlapByQueue": dict(sorted(phase1_by_queue.items())),
            "sourceQueueCounts": queue_counts,
        },
        "normalPrimaryCandidatesRemaining": normal_missing_rows,
        "phase1OverlapWithinCurrentAudit": [
            {**queues[code], "reviewArtifactExists": code in reviews, "reviewFiles": review_files.get(code, [])}
            for code in sorted(phase1_overlap)
        ],
        "reviewArtifactsOutsideCurrentAudit": [
            {"code": code, "reviewFiles": review_files.get(code, []), "previousWaveAssignments": assigned.get(code, [])}
            for code in sorted(artifacts_outside_audit)
        ],
        "policy": {
            "currentSourceRelevanceAuditPartitions450": True,
            "canonicalReviewArtifactRequiredForCompletion": True,
            "phase1OverlapMustNotBeDoubleCountedAsPhase2Additional": True,
            "normalGeneratorMayConsumeExceptionQueues": False,
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
        },
    }

    if len(reviewed_in_audit) + len(remaining_in_audit) != 450:
        raise SystemExit("reviewed + remaining current audit coverage must equal 450")

    if args.write:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(output["counts"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
