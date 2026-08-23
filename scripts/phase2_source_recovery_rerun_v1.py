#!/usr/bin/env python3
"""Rerun collection only for unresolved Phase 2 source-recovery companies.

This recovery utility is intentionally narrow:
- target membership comes from the current source-recovery audit queue;
- companies that already have canonical primary-review artifacts are skipped;
- only the target company's bulk-collection directory is replaced;
- wave/batch/full-rollout summaries are rebuilt after collection;
- no fact review, quality approval, or Deep Verification approval is performed.

The main use case is recovering source packets that previously failed because the
runtime lacked PDF crypto support. Network/404/403 failures remain visible in the
recovery report for later manual source repair.
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
BULK_ROOT = PHASE2 / "bulk-collection"
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
        for path in directory.glob("*.json"):
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


def source_recovery_codes() -> list[str]:
    payload = read_json(SOURCE_RECOVERY_QUEUE)
    companies = payload.get("companies") if isinstance(payload, dict) else None
    if not isinstance(companies, list):
        raise SystemExit(f"source recovery queue has no companies list: {SOURCE_RECOVERY_QUEUE}")
    codes: list[str] = []
    for row in companies:
        if not isinstance(row, dict):
            continue
        code = normalize_code(row.get("code"))
        if code is None:
            raise SystemExit(f"invalid source recovery company code: {row.get('code')!r}")
        codes.append(code)
    if len(codes) != len(set(codes)):
        raise SystemExit("duplicate company code in source recovery queue")
    return codes


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


def rebuild_wave_summary(batch_no: int, wave_no: int, locations: dict[str, dict[str, Any]]) -> None:
    wave_dir = BULK_ROOT / f"batch-{batch_no:02d}" / f"wave-{wave_no:02d}"
    rows = sorted(
        (
            location
            for location in locations.values()
            if location["batch"] == batch_no and location["wave"] == wave_no
        ),
        key=lambda row: row["order"],
    )
    if len(rows) != 10:
        raise SystemExit(f"wave mapping incomplete: batch={batch_no} wave={wave_no} rows={len(rows)}")

    results: list[dict[str, Any]] = []
    for location in rows:
        code = str(location["company"]["code"])
        collection_path = wave_dir / code / "collection.json"
        if not collection_path.exists():
            raise SystemExit(f"missing collection while rebuilding wave summary: {collection_path}")
        results.append(read_json(collection_path))

    counts = Counter(str(row.get("status")) for row in results)
    summary = {
        "schemaVersion": "phase2-bulk-collection-wave-v1",
        "batch": batch_no,
        "wave": wave_no,
        "orders": f"{rows[0]['order']}-{rows[-1]['order']}",
        "targetCompanies": 10,
        "processedCompanies": len(results),
        "counts": dict(counts),
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": 0,
        "companies": [
            {
                "order": row["order"],
                "code": row["company"]["code"],
                "name": row["company"]["name"],
                "status": row.get("status"),
                "resolvedPdfUrl": row.get("resolvedPdfUrl"),
                "pageCount": row.get("pageCount"),
                "documentTypeCandidate": row.get("documentTypeCandidate"),
            }
            for row in results
        ],
    }
    write_json(wave_dir / "summary.json", summary)


def rebuild_batch_summary(batch_no: int) -> None:
    batch_dir = BULK_ROOT / f"batch-{batch_no:02d}"
    summaries = [read_json(path) for path in sorted(batch_dir.glob("wave-*/summary.json"))]
    if len(summaries) != 5:
        raise SystemExit(f"expected 5 wave summaries in batch {batch_no}, found {len(summaries)}")
    counts: Counter[str] = Counter()
    companies: list[dict[str, Any]] = []
    for summary in summaries:
        counts.update(summary.get("counts", {}))
        companies.extend(summary.get("companies", []))
    report = {
        "schemaVersion": "phase2-bulk-collection-batch-v1",
        "batch": batch_no,
        "wavesExpected": 5,
        "wavesCollected": 5,
        "targetCompanies": 50,
        "processedCompanies": len(companies),
        "uniqueCompanies": len({str(row.get('code')) for row in companies}),
        "counts": dict(counts),
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": 0,
        "companies": companies,
    }
    write_json(batch_dir / "summary.json", report)


def rebuild_full_rollout_summary() -> None:
    batches: list[dict[str, Any]] = []
    all_companies: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for batch_no in range(2, 11):
        path = BULK_ROOT / f"batch-{batch_no:02d}" / "summary.json"
        if not path.exists():
            batches.append({"batch": batch_no, "status": "artifact_missing"})
            continue
        summary = read_json(path)
        batches.append(
            {
                "batch": batch_no,
                "status": "collected",
                "processedCompanies": summary.get("processedCompanies"),
                "counts": summary.get("counts", {}),
            }
        )
        all_companies.extend(summary.get("companies", []))
        counts.update(summary.get("counts", {}))
    report = {
        "schemaVersion": "phase2-full-rollout-collection-v1",
        "targetAdditionalCompanies": 450,
        "collectedCompanies": len(all_companies),
        "uniqueCompanies": len({str(row.get('code')) for row in all_companies}),
        "batchesExpected": 9,
        "batchesCollected": sum(1 for row in batches if row["status"] == "collected"),
        "counts": dict(counts),
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": 0,
        "batches": batches,
    }
    write_json(BULK_ROOT / "full-rollout-summary.json", report)


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
    audit_codes = source_recovery_codes()
    unresolved_codes = [code for code in audit_codes if code not in reviewed]
    if args.limit > 0:
        unresolved_codes = unresolved_codes[: args.limit]

    locations = company_locations()
    missing_from_queue = [code for code in unresolved_codes if code not in locations]
    if missing_from_queue:
        raise SystemExit(f"source recovery companies missing from Phase 2 queue: {missing_from_queue}")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.8"})

    results: list[dict[str, Any]] = []
    affected_waves: set[tuple[int, int]] = set()
    affected_batches: set[int] = set()

    for code in unresolved_codes:
        location = locations[code]
        batch_no = location["batch"]
        wave_no = location["wave"]
        company = location["company"]
        order = location["order"]
        wave_dir = BULK_ROOT / f"batch-{batch_no:02d}" / f"wave-{wave_no:02d}"
        company_dir = wave_dir / code

        if company_dir.exists():
            shutil.rmtree(company_dir)

        result = process_company(session, company, order, wave_dir)
        results.append(
            {
                "code": code,
                "name": company.get("name"),
                "batch": batch_no,
                "wave": wave_no,
                "order": order,
                "status": result.get("status"),
                "resolvedPdfUrl": result.get("resolvedPdfUrl"),
                "documentTypeCandidate": result.get("documentTypeCandidate"),
                "pageCount": result.get("pageCount"),
                "errorType": result.get("errorType"),
                "error": result.get("error"),
            }
        )
        affected_waves.add((batch_no, wave_no))
        affected_batches.add(batch_no)
        print(json.dumps(results[-1], ensure_ascii=False), flush=True)

    for batch_no, wave_no in sorted(affected_waves):
        rebuild_wave_summary(batch_no, wave_no, locations)
    for batch_no in sorted(affected_batches):
        rebuild_batch_summary(batch_no)
    rebuild_full_rollout_summary()

    status_counts = Counter(row["status"] for row in results)
    report = {
        "schemaVersion": "phase2-source-recovery-rerun-v1",
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sourceQueue": str(SOURCE_RECOVERY_QUEUE.relative_to(ROOT)),
        "auditQueueCompanies": len(audit_codes),
        "alreadyReviewedSkipped": len([code for code in audit_codes if code in reviewed]),
        "targetsAttempted": len(results),
        "counts": dict(status_counts),
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
