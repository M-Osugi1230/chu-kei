#!/usr/bin/env python3
"""Build the remaining Phase 2 exception remediation queue.

The normal Phase 2 primary-review candidate queue is exhausted after Wave 38.
This script uses the latest source-relevance audit as the source of truth for
exception classifications, then subtracts companies that already have a
canonical primary-review artifact.

It does not recover sources, infer facts, complete reviews, or approve quality.
Its only purpose is to establish an auditable remaining-work ledger and to
separate already-reviewed exceptions from companies that still require source
remediation before primary review.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PHASE2 = ROOT / "operations" / "quality-rebase" / "phase2"
AUDIT_DIR = PHASE2 / "source-relevance-audit"
PRIMARY_REVIEW_DIRS = [
    PHASE2 / "primary-reviews",
    PHASE2 / "reviews",
]
OUTPUT = PHASE2 / "source-repairs" / "remaining-exception-remediation-v1.json"

QUEUE_FILES = {
    "manual_source_relevance_check": AUDIT_DIR / "manual-source-relevance-check.json",
    "pdf_identification_required": AUDIT_DIR / "pdf-identification-required.json",
    "probable_wrong_document": AUDIT_DIR / "probable-wrong-document.json",
    "source_recovery_required": AUDIT_DIR / "source-recovery-required.json",
}
EXPECTED_AUDIT_COUNTS = {
    "manual_source_relevance_check": 19,
    "pdf_identification_required": 14,
    "probable_wrong_document": 8,
    "source_recovery_required": 52,
}
CODE_PATTERN = re.compile(r"^(?:\d{4}|\d{3}[A-Z])$")
REVIEW_FILE_PATTERN = re.compile(r"^(?P<code>(?:\d{4}|\d{3}[A-Z]))(?:-wave\d+)?-primary-review-v\d+\.json$")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_code(value: Any) -> str | None:
    if value is None:
        return None
    code = str(value).strip()
    return code if CODE_PATTERN.fullmatch(code) else None


def extract_companies(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path)
    companies = payload.get("companies") if isinstance(payload, dict) else None
    if not isinstance(companies, list):
        raise SystemExit(f"queue has no companies list: {path}")
    rows = [row for row in companies if isinstance(row, dict)]
    return rows


def collect_exception_rows() -> dict[str, dict[str, Any]]:
    rows_by_code: dict[str, dict[str, Any]] = {}
    actual_counts: dict[str, int] = {}

    for queue, path in QUEUE_FILES.items():
        if not path.exists():
            raise SystemExit(f"missing current source relevance queue: {path}")
        rows = extract_companies(path)
        actual_counts[queue] = len(rows)
        for row in rows:
            code = normalize_code(row.get("code"))
            if code is None:
                raise SystemExit(f"invalid company code in {path}: {row.get('code')!r}")
            if code in rows_by_code:
                raise SystemExit(f"duplicate exception company across current queues: {code}")
            rows_by_code[code] = {
                "code": code,
                "name": row.get("name"),
                "queue": queue,
                "relevanceScore": row.get("relevanceScore"),
                "documentTypeCandidate": row.get("documentTypeCandidate"),
                "sourceUrl": row.get("sourceUrl"),
                "resolvedPdfUrl": row.get("resolvedPdfUrl"),
                "collectionStatus": row.get("collectionStatus"),
                "reasons": row.get("reasons", []),
                "blockers": row.get("blockers", []),
                "errorType": row.get("errorType"),
                "error": row.get("error"),
                "auditSourceFile": str(path.relative_to(ROOT)),
            }

    if actual_counts != EXPECTED_AUDIT_COUNTS:
        raise SystemExit(
            f"current audit count mismatch: expected={EXPECTED_AUDIT_COUNTS}, actual={actual_counts}"
        )
    if len(rows_by_code) != sum(EXPECTED_AUDIT_COUNTS.values()):
        raise SystemExit(f"expected 93 unique current exceptions, found {len(rows_by_code)}")
    return rows_by_code


def review_identity(path: Path) -> tuple[str | None, str | None]:
    filename_match = REVIEW_FILE_PATTERN.fullmatch(path.name)
    filename_code = filename_match.group("code") if filename_match else None
    try:
        payload = load_json(path)
    except (OSError, json.JSONDecodeError):
        return filename_code, None
    if not isinstance(payload, dict):
        return filename_code, None
    company = payload.get("company")
    json_code = normalize_code(company.get("code")) if isinstance(company, dict) else None
    return filename_code, json_code


def collect_reviewed_codes() -> tuple[set[str], dict[str, list[str]]]:
    reviewed: set[str] = set()
    evidence: dict[str, list[str]] = {}
    for directory in PRIMARY_REVIEW_DIRS:
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.json")):
            filename_code, json_code = review_identity(path)
            code = json_code or filename_code
            if code is None:
                continue
            if filename_code and json_code and filename_code != json_code:
                raise SystemExit(
                    f"review identity mismatch: file={path} filename={filename_code} json={json_code}"
                )
            reviewed.add(code)
            evidence.setdefault(code, []).append(str(path.relative_to(ROOT)))
    return reviewed, evidence


def assignment_codes() -> dict[str, list[int]]:
    assigned: dict[str, list[int]] = {}
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
        for row in companies:
            if not isinstance(row, dict):
                continue
            code = normalize_code(row.get("code"))
            if code is None:
                continue
            assigned.setdefault(code, []).append(wave)
    return assigned


def remediation_action(queue: str) -> str:
    return {
        "manual_source_relevance_check": "human_document_boundary_review",
        "pdf_identification_required": "identify_official_pdf_or_html_source",
        "probable_wrong_document": "discard_wrong_candidate_and_research_official_ir",
        "source_recovery_required": "recover_or_replace_official_source",
    }[queue]


def priority(queue: str, score: Any) -> int:
    base = {
        "manual_source_relevance_check": 400,
        "pdf_identification_required": 300,
        "probable_wrong_document": 200,
        "source_recovery_required": 100,
    }[queue]
    numeric = int(score) if isinstance(score, (int, float)) else 0
    return base + max(min(numeric, 99), -99)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    exceptions = collect_exception_rows()
    reviewed_codes, review_evidence = collect_reviewed_codes()
    assigned = assignment_codes()

    reviewed_exception_codes = sorted(set(exceptions) & reviewed_codes)
    remaining_codes = sorted(set(exceptions) - reviewed_codes)
    assigned_without_review_codes = sorted((set(exceptions) & set(assigned)) - reviewed_codes)

    remaining: list[dict[str, Any]] = []
    for code in remaining_codes:
        row = exceptions[code]
        queue = row["queue"]
        remaining.append(
            {
                **row,
                "priority": priority(queue, row.get("relevanceScore")),
                "requiredAction": remediation_action(queue),
                "previousWaveAssignments": sorted(assigned.get(code, [])),
                "status": "source_remediation_required_before_primary_review",
                "automaticFactCompletionAllowed": False,
                "automaticApprovalAllowed": False,
                "deepVerificationApproved": False,
            }
        )
    remaining.sort(key=lambda row: (-row["priority"], row["code"]))

    reviewed_exceptions = [
        {
            **exceptions[code],
            "reviewFiles": review_evidence.get(code, []),
            "previousWaveAssignments": sorted(assigned.get(code, [])),
            "status": "primary_review_artifact_exists",
        }
        for code in reviewed_exception_codes
    ]

    remaining_counts = Counter(row["queue"] for row in remaining)
    reviewed_counts = Counter(row["queue"] for row in reviewed_exceptions)

    output = {
        "schemaVersion": "phase2-remaining-exception-remediation-v1",
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sourceOfTruth": {
            "sourceRelevanceAudit": "operations/quality-rebase/phase2/source-relevance-audit/summary.json",
            "oldSourceRelevanceV2IsHistoricalOnly": True,
            "normalPrimaryReviewCandidateQueueExhausted": True,
        },
        "counts": {
            "currentAuditExceptions": len(exceptions),
            "reviewedExceptionCompanies": len(reviewed_exceptions),
            "remainingExceptionCompanies": len(remaining),
            "assignedWithoutPrimaryReviewArtifact": len(assigned_without_review_codes),
            "remainingByQueue": dict(sorted(remaining_counts.items())),
            "reviewedByQueue": dict(sorted(reviewed_counts.items())),
        },
        "assignedWithoutPrimaryReviewArtifact": [
            {
                "code": code,
                "name": exceptions[code].get("name"),
                "queue": exceptions[code]["queue"],
                "previousWaveAssignments": sorted(assigned.get(code, [])),
            }
            for code in assigned_without_review_codes
        ],
        "reviewedExceptions": reviewed_exceptions,
        "remaining": remaining,
        "nextActionPolicy": {
            "normalWaveGeneratorMayConsumeExceptionQueues": False,
            "sourceRemediationRequiredBeforePrimaryReview": True,
            "probableWrongDocumentMayBeReviewedAsPlanWithoutReplacement": False,
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
        },
    }

    # 450 total Phase 2 companies = 357 normal candidates + 93 current exceptions.
    # If the normal candidate queue is exhausted and the project ledger says 370
    # primary reviews are complete, 13 current-exception companies should already
    # have review artifacts and 80 should remain. Treat divergence as a hard stop.
    if len(reviewed_exceptions) != 13 or len(remaining) != 80:
        raise SystemExit(
            "exception reconciliation mismatch: expected reviewed=13 remaining=80, "
            f"actual reviewed={len(reviewed_exceptions)} remaining={len(remaining)}; "
            "inspect review artifact coverage before proceeding"
        )

    if assigned_without_review_codes:
        # Do not fail solely because a historical assignment exists without an
        # artifact, but surface it explicitly so the next recovery cohort cannot
        # silently duplicate or skip it.
        output["warnings"] = [
            "One or more exception companies were historically assigned but have no canonical primary-review artifact. "
            "They remain in remediation until the source and review artifact are completed."
        ]

    if args.write:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(output["counts"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
