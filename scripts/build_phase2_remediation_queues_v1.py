#!/usr/bin/env python3
"""Build actionable remediation queues for Phase 2 source exceptions.

This script reads the completed Phase 2 source relevance audit and converts every
non-primary-review candidate into one of four explicit remediation queues:

- likely wrong document
- source recovery
- PDF identification
- human relevance review

It never marks a company as reviewed or approved. The output is an operational
queue only, with deterministic priority and retry strategy.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "operations/quality-rebase/phase2/source-relevance-v2/summary.json"
DEFAULT_OUTPUT = ROOT / "operations/quality-rebase/phase2/remediation-v1"

EXPECTED_COUNTS = {
    "human_relevance_review_required": 11,
    "likely_wrong_document": 60,
    "pdf_identification_required": 14,
    "source_recovery_required": 52,
}

NEGATIVE_SIGNAL_STRATEGIES = {
    "holiday_notice": "discard_candidate_and_rescan_official_ir_library",
    "recruitment_material": "discard_candidate_and_rescan_management_strategy_pages",
    "shareholder_meeting_notice": "discard_candidate_and_search_midterm_plan_or_integrated_report",
    "articles_of_incorporation": "discard_candidate_and_search_management_policy_or_plan",
    "governance_report": "treat_as_supplement_only_and_find_formal_plan",
    "financial_results_only": "treat_as_progress_source_only_and_find_plan_baseline",
    "short_ir_notice": "inspect_linked_attachment_and_parent_ir_page",
    "unknown": "manual_official_domain_research",
}

RECOVERY_STRATEGIES = {
    "http_403": "retry_with_browser_headers_then_use_official_html_as_fallback",
    "http_404": "search_official_ir_library_and_replace_stale_url",
    "http_429": "retry_with_backoff_and_cache_result",
    "http_5xx": "retry_later_then_use_official_mirror_or_parent_page",
    "timeout": "retry_with_extended_timeout_and_streaming_download",
    "tls_error": "retry_with_current_ca_bundle_and_official_parent_page",
    "oversized_pdf": "stream_download_and_extract_pages_incrementally",
    "pdf_parse_error": "redownload_validate_magic_bytes_then_use_alternate_parser",
    "html_parse_error": "use_browser_rendered_html_or_manual_source_mapping",
    "unknown": "manual_official_domain_research",
}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_status(row: dict[str, Any]) -> str:
    for key in ("queue", "classification", "status", "decision"):
        value = row.get(key)
        if isinstance(value, str):
            normalized = value.strip().lower().replace("-", "_")
            aliases = {
                "human_relevance_review": "human_relevance_review_required",
                "manual_relevance_review": "human_relevance_review_required",
                "wrong_document": "likely_wrong_document",
                "pdf_not_found": "pdf_identification_required",
                "source_recovery": "source_recovery_required",
            }
            return aliases.get(normalized, normalized)
    raise ValueError(f"row has no recognizable status: {row.get('code')} {row.get('name')}")


def extract_rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("companies", "results", "records", "items"):
        value = data.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]

    queues = data.get("queues")
    if isinstance(queues, dict):
        rows: list[dict[str, Any]] = []
        for status, values in queues.items():
            if not isinstance(values, list):
                continue
            for value in values:
                if isinstance(value, dict):
                    rows.append({**value, "queue": value.get("queue", status)})
        if rows:
            return rows

    raise ValueError("source relevance summary contains no company rows")


def infer_negative_signal(row: dict[str, Any]) -> str:
    haystack = " ".join(
        str(row.get(key, ""))
        for key in ("negativeSignal", "reason", "documentTitle", "selectedPdf", "notes", "error")
    ).lower()
    patterns = [
        ("holiday_notice", ("休日", "休業", "holiday")),
        ("recruitment_material", ("採用", "recruit", "career")),
        ("shareholder_meeting_notice", ("株主総会", "招集", "general meeting")),
        ("articles_of_incorporation", ("定款", "articles of incorporation")),
        ("governance_report", ("ガバナンス", "governance report")),
        ("financial_results_only", ("決算短信", "financial results", "earnings release")),
        ("short_ir_notice", ("お知らせ", "notice")),
    ]
    for signal, needles in patterns:
        if any(needle in haystack for needle in needles):
            return signal
    return "unknown"


def infer_recovery_reason(row: dict[str, Any]) -> str:
    haystack = " ".join(str(row.get(key, "")) for key in ("error", "reason", "statusCode", "notes")).lower()
    patterns = [
        ("http_403", ("403", "forbidden")),
        ("http_404", ("404", "not found")),
        ("http_429", ("429", "too many requests")),
        ("http_5xx", ("500", "502", "503", "504", "server error")),
        ("timeout", ("timeout", "timed out")),
        ("tls_error", ("ssl", "tls", "certificate")),
        ("oversized_pdf", ("too large", "oversized", "size limit")),
        ("pdf_parse_error", ("pdf parse", "invalid pdf", "xref", "eof marker")),
        ("html_parse_error", ("html parse", "javascript required", "render")),
    ]
    for reason, needles in patterns:
        if any(needle in haystack for needle in needles):
            return reason
    return "unknown"


def priority_for(status: str, row: dict[str, Any]) -> int:
    score = row.get("relevanceScore")
    numeric_score = int(score) if isinstance(score, (int, float)) else 0
    base = {
        "human_relevance_review_required": 100,
        "pdf_identification_required": 90,
        "likely_wrong_document": 80,
        "source_recovery_required": 70,
    }[status]
    return base + min(max(numeric_score, 0), 50)


def build_entry(status: str, row: dict[str, Any]) -> dict[str, Any]:
    code = str(row.get("code", "")).strip()
    name = str(row.get("name", "")).strip()
    if not code or not name:
        raise ValueError(f"missing company identity: {row}")

    entry: dict[str, Any] = {
        "code": code,
        "name": name,
        "sourceUrl": row.get("sourceUrl") or row.get("url"),
        "selectedDocument": row.get("documentTitle") or row.get("selectedPdf") or row.get("document"),
        "originalReason": row.get("reason") or row.get("error") or row.get("notes"),
        "priority": priority_for(status, row),
        "status": "queued",
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": False,
    }

    if status == "likely_wrong_document":
        signal = infer_negative_signal(row)
        entry.update(
            {
                "negativeSignal": signal,
                "retryStrategy": NEGATIVE_SIGNAL_STRATEGIES[signal],
                "completionCondition": "replacement official source identified and human relevance review completed",
            }
        )
    elif status == "source_recovery_required":
        reason = infer_recovery_reason(row)
        entry.update(
            {
                "recoveryReason": reason,
                "retryStrategy": RECOVERY_STRATEGIES[reason],
                "completionCondition": "official source fetched or official HTML fallback mapped and human checked",
            }
        )
    elif status == "pdf_identification_required":
        entry.update(
            {
                "retryStrategy": "inspect_official_html_links_then_search_official_domain_for_plan_pdf",
                "completionCondition": "formal plan PDF or official HTML evidence source identified and human checked",
            }
        )
    elif status == "human_relevance_review_required":
        entry.update(
            {
                "retryStrategy": "human_compare_document_title_scope_years_and_company_identity",
                "completionCondition": "human relevance decision recorded with evidence",
            }
        )
    return entry


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    data = load_json(args.input)
    rows = extract_rows(data)

    queues: dict[str, list[dict[str, Any]]] = {key: [] for key in EXPECTED_COUNTS}
    seen_codes: set[str] = set()

    for row in rows:
        status = normalize_status(row)
        if status not in queues:
            continue
        code = str(row.get("code", "")).strip()
        if code in seen_codes:
            raise SystemExit(f"duplicate remediation company code: {code}")
        seen_codes.add(code)
        queues[status].append(build_entry(status, row))

    actual_counts = {key: len(value) for key, value in queues.items()}
    if actual_counts != EXPECTED_COUNTS:
        raise SystemExit(f"remediation count mismatch: expected={EXPECTED_COUNTS}, actual={actual_counts}")
    if len(seen_codes) != 137:
        raise SystemExit(f"expected 137 unique remediation companies, found {len(seen_codes)}")

    for status, entries in queues.items():
        entries.sort(key=lambda item: (-item["priority"], item["code"]))
        write_json(
            args.output / f"{status}.json",
            {
                "schemaVersion": "phase2-remediation-queue-v1",
                "queue": status,
                "targetCompanies": len(entries),
                "automaticFactCompletionAllowed": False,
                "automaticApprovalAllowed": False,
                "deepVerificationApproved": 0,
                "companies": entries,
            },
        )

    negative_signals = Counter(
        row["negativeSignal"] for row in queues["likely_wrong_document"]
    )
    recovery_reasons = Counter(
        row["recoveryReason"] for row in queues["source_recovery_required"]
    )
    summary = {
        "schemaVersion": "phase2-remediation-summary-v1",
        "sourceRelevanceAudit": str(args.input.relative_to(ROOT)),
        "targetCompanies": 137,
        "uniqueCompanies": len(seen_codes),
        "counts": actual_counts,
        "negativeSignalBreakdown": dict(sorted(negative_signals.items())),
        "sourceRecoveryBreakdown": dict(sorted(recovery_reasons.items())),
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": 0,
        "completionRule": "Queue generation is not source repair, primary review, independent review, or approval.",
    }
    write_json(args.output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
