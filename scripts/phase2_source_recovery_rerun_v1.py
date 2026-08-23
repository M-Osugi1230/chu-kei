#!/usr/bin/env python3
"""Rerun collection only for unresolved Phase 2 source-recovery companies.

Safety model:
- target membership comes from the current source-recovery audit queue;
- companies that already have canonical primary-review artifacts are skipped;
- recovered packets are written to an isolated recovery directory and NEVER
  replace the historical bulk-collection packets;
- the script only collects source evidence. It never completes a human review,
  grants quality approval, or grants Deep Verification approval;
- network/HTTP/DNS failures remain explicit in the recovery report for manual
  source repair.

The primary use case is recovering packets that previously failed because the
runtime lacked PDF AES/crypto support.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from phase2_bulk_collect_v1 import USER_AGENT, process_company, read_json, write_json

ROOT = Path(__file__).resolve().parents[1]
PHASE2 = ROOT / "operations" / "quality-rebase" / "phase2"
QUEUE_PATH = ROOT / "operations" / "quality-rebase" / "phase2-queue-500-v1.json"
SOURCE_RECOVERY_QUEUE = PHASE2 / "source-relevance-audit" / "source-recovery-required.json"
RECOVERY_ROOT = PHASE2 / "source-recovery-collection-v1"
REPORT_PATH = PHASE2 / "source-repairs" / "source-recovery-rerun-v1.json"
PRIMARY_REVIEW_DIRS = [PHASE2 / "primary-reviews", PHASE2 / "reviews"]
CODE_PATTERN = re.compile(r"^(?:\d{4}|\d{3}[A-Z])$")
REVIEW_FILE_PATTERN = re.compile(
    r"^(?P<code>(?:\d{4}|\d{3}[A-Z]))(?:-wave\d+)?-primary-review-v\d+\.json$"
)


def normalize_code(value: Any) -> str | None:
    if value is None:
        return None
    code = str(value).strip()
    return code if CODE_PATTERN.fullmatch(code) else None


def canonical_review_codes() -> set[str]:
    reviewed: set[str] = set()
    for directory in PRIMARY_REVIEW_DIRS:
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.json")):
            match = REVIEW_FILE_PATTERN.fullmatch(path.name)
            filename_code = match.group("code") if match else None
            json_code = None
            try:
                payload = read_json(path)
                company = payload.get("company") if isinstance(payload, dict) else None
                if isinstance(company, dict):
                    json_code = normalize_code(company.get("code"))
            except Exception:
                pass
            if filename_code and json_code and filename_code != json_code:
                raise SystemExit(
                    f"review identity mismatch: {path} filename={filename_code} json={json_code}"
                )
            code = json_code or filename_code
            if code:
                reviewed.add(code)
    return reviewed


def source_recovery_rows() -> list[dict[str, Any]]:
    payload = read_json(SOURCE_RECOVERY_QUEUE)
    companies = payload.get("companies") if isinstance(payload, dict) else None
    if not isinstance(companies, list):
        raise SystemExit(f"source recovery queue has no companies list: {SOURCE_RECOVERY_QUEUE}")

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in companies:
        if not isinstance(row, dict):
            continue
        code = normalize_code(row.get("code"))
        if code is None:
            raise SystemExit(f"invalid source recovery company code: {row.get('code')!r}")
        if code in seen:
            raise SystemExit(f"duplicate company code in source recovery queue: {code}")
        seen.add(code)
        rows.append({**row, "code": code})
    return rows


def company_locations() -> dict[str, dict[str, Any]]:
    queue = read_json(QUEUE_PATH)
    result: dict[str, dict[str, Any]] = {}
    for batch in queue.get("batches", []):
        batch_no = batch.get("batch")
        companies = batch.get("companies")
        if not isinstance(batch_no, int) or not isinstance(companies, list):
            continue
        for offset, company in enumerate(companies):
            if not isinstance(company, dict):
                continue
            code = normalize_code(company.get("code"))
            if code is None:
                continue
            wave = offset // 10 + 1
            index_in_wave = offset % 10
            order = 51 + (batch_no - 2) * 50 + (wave - 1) * 10 + index_in_wave
            if code in result:
                raise SystemExit(f"duplicate Phase 2 queue company code: {code}")
            result[code] = {
                "batch": batch_no,
                "wave": wave,
                "order": order,
                "company": company,
            }
    return result


def safe_clear_target(code: str) -> Path:
    target = RECOVERY_ROOT / code
    if target.exists():
        shutil.rmtree(target)
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional target limit for diagnostics; 0 means all unresolved source-recovery companies.",
    )
    args = parser.parse_args()

    reviewed = canonical_review_codes()
    audit_rows = source_recovery_rows()
    unresolved_rows = [row for row in audit_rows if row["code"] not in reviewed]
    if args.limit > 0:
        unresolved_rows = unresolved_rows[: args.limit]

    locations = company_locations()
    missing_from_queue = [row["code"] for row in unresolved_rows if row["code"] not in locations]
    if missing_from_queue:
        raise SystemExit(f"source recovery companies missing from Phase 2 queue: {missing_from_queue}")

    RECOVERY_ROOT.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.8"})

    results: list[dict[str, Any]] = []
    for audit_row in unresolved_rows:
        code = audit_row["code"]
        location = locations[code]
        company = location["company"]
        order = location["order"]

        safe_clear_target(code)
        # process_company writes to output_dir / code, therefore RECOVERY_ROOT is
        # the isolated output directory for every recovery target.
        result = process_company(session, company, order, RECOVERY_ROOT)
        recovery_path = RECOVERY_ROOT / code

        report_row = {
            "code": code,
            "name": company.get("name"),
            "batch": location["batch"],
            "wave": location["wave"],
            "order": order,
            "previousErrorType": audit_row.get("errorType"),
            "previousError": audit_row.get("error"),
            "status": result.get("status"),
            "resolvedPageUrl": result.get("resolvedPageUrl"),
            "resolvedPdfUrl": result.get("resolvedPdfUrl"),
            "documentTypeCandidate": result.get("documentTypeCandidate"),
            "pageCount": result.get("pageCount"),
            "textCharacters": result.get("textCharacters"),
            "pdfSha256": result.get("pdfSha256"),
            "errorType": result.get("errorType"),
            "error": result.get("error"),
            "recoveryDirectory": str(recovery_path.relative_to(ROOT)),
            "requiresPrimaryHumanReview": result.get("status") == "collection_complete_primary_human_review_pending",
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
        }
        results.append(report_row)
        print(json.dumps(report_row, ensure_ascii=False), flush=True)

    status_counts = Counter(str(row["status"]) for row in results)
    previous_error_counts = Counter(str(row.get("previousErrorType")) for row in results)
    current_error_counts = Counter(
        str(row.get("errorType")) for row in results if row.get("status") == "collection_failed"
    )
    successful_codes = [
        row["code"]
        for row in results
        if row["status"] == "collection_complete_primary_human_review_pending"
    ]
    unresolved_codes = [row["code"] for row in results if row["status"] != "collection_complete_primary_human_review_pending"]

    report = {
        "schemaVersion": "phase2-source-recovery-rerun-v1",
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sourceQueue": str(SOURCE_RECOVERY_QUEUE.relative_to(ROOT)),
        "recoveryRoot": str(RECOVERY_ROOT.relative_to(ROOT)),
        "auditQueueCompanies": len(audit_rows),
        "alreadyReviewedSkipped": len([row for row in audit_rows if row["code"] in reviewed]),
        "targetsAttempted": len(results),
        "counts": dict(status_counts),
        "previousErrorTypeCounts": dict(previous_error_counts),
        "currentFailedErrorTypeCounts": dict(current_error_counts),
        "successfulRecoveryCodes": successful_codes,
        "stillUnresolvedCodes": unresolved_codes,
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": False,
        "results": results,
    }
    write_json(REPORT_PATH, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
