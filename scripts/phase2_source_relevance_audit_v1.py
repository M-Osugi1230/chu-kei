#!/usr/bin/env python3
"""Audit Phase 2 collected documents for source relevance.

This script never confirms a formal plan and never grants deep verification.
It only prioritizes collected packets for primary human review or remediation.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
COLLECTION_ROOT = ROOT / "operations" / "quality-rebase" / "phase2" / "bulk-collection"
OUTPUT_ROOT = ROOT / "operations" / "quality-rebase" / "phase2" / "source-relevance-audit"

PLAN_TERMS = re.compile(
    r"(中期経営計画|中長期経営計画|経営計画|経営戦略|経営方針|事業計画|"
    r"成長可能性|management\s*plan|mid[-\s]?term|business\s*plan|strategy)",
    re.IGNORECASE,
)
STRONG_PLAN_TERMS = re.compile(
    r"(中期経営計画|中長期経営計画|事業計画及び成長可能性|"
    r"medium[-\s]?term\s+management\s+plan|mid[-\s]?term\s+management\s+plan)",
    re.IGNORECASE,
)
METRIC_TERMS = re.compile(
    r"(売上|売上高|収益|営業利益|事業利益|経常利益|純利益|ROE|ROIC|ROA|"
    r"EBITDA|EPS|配当|還元|投資|キャッシュフロー|自己資本比率|D/E)",
    re.IGNORECASE,
)
STRATEGY_TERMS = re.compile(
    r"(重点戦略|基本戦略|成長戦略|事業戦略|経営課題|ポートフォリオ|"
    r"構造改革|DX|M&A|研究開発|人的資本|サステナビリティ)",
    re.IGNORECASE,
)
YEAR_TERMS = re.compile(r"(20\d{2}(?:年度|年)|FY\s*20\d{2})", re.IGNORECASE)

NEGATIVE_TERMS = re.compile(
    r"(休日のお知らせ|休業のお知らせ|営業時間|採用情報|人事異動|訃報|"
    r"株主総会招集通知|議決権行使|配当金領収証|決算短信|法定開示|"
    r"コーポレートガバナンス報告書|定款|大量保有報告書|臨時報告書)",
    re.IGNORECASE,
)
SEVERE_NEGATIVE_TERMS = re.compile(
    r"(休日のお知らせ|休業のお知らせ|営業時間|採用情報|訃報)",
    re.IGNORECASE,
)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def basename_from_url(url: str | None) -> str:
    if not url:
        return ""
    return unquote(Path(urlparse(url).path).name)


def count_matches(pattern: re.Pattern[str], text: str) -> int:
    return len(pattern.findall(text))


def score_packet(collection: dict[str, Any], full_text: str) -> dict[str, Any]:
    company = collection.get("company") or {}
    expected_title = normalize(company.get("document"))
    html_title = normalize(collection.get("htmlTitle"))
    pdf_name = normalize(basename_from_url(collection.get("resolvedPdfUrl")))
    excerpt = normalize(full_text[:30000])
    identity_text = " ".join([expected_title, html_title, pdf_name, excerpt[:8000]])

    score = 0
    reasons: list[str] = []
    blockers: list[str] = []

    strong_plan_hits = count_matches(STRONG_PLAN_TERMS, identity_text)
    plan_hits = count_matches(PLAN_TERMS, identity_text)
    metric_hits = count_matches(METRIC_TERMS, excerpt)
    strategy_hits = count_matches(STRATEGY_TERMS, excerpt)
    year_hits = count_matches(YEAR_TERMS, excerpt)
    negative_hits = count_matches(NEGATIVE_TERMS, identity_text)
    severe_negative_hits = count_matches(SEVERE_NEGATIVE_TERMS, identity_text)

    if expected_title and expected_title in identity_text:
        score += 30
        reasons.append("expected_title_present")
    if strong_plan_hits:
        score += min(35, 15 + strong_plan_hits * 5)
        reasons.append("strong_plan_terms_present")
    elif plan_hits:
        score += min(20, 8 + plan_hits * 3)
        reasons.append("plan_terms_present")
    if metric_hits >= 5:
        score += 15
        reasons.append("multiple_financial_metric_terms")
    elif metric_hits:
        score += 5
        reasons.append("financial_metric_terms_present")
    if strategy_hits >= 3:
        score += 10
        reasons.append("multiple_strategy_terms")
    elif strategy_hits:
        score += 4
        reasons.append("strategy_terms_present")
    if year_hits >= 2:
        score += 8
        reasons.append("multiple_year_references")
    elif year_hits:
        score += 3
        reasons.append("year_reference_present")

    page_count = collection.get("pageCount")
    text_characters = collection.get("textCharacters") or len(full_text)
    if isinstance(page_count, int) and page_count >= 8:
        score += 5
        reasons.append("substantive_page_count")
    if text_characters >= 5000:
        score += 5
        reasons.append("substantive_text_volume")

    if negative_hits:
        score -= min(45, 20 + negative_hits * 10)
        blockers.append("negative_document_terms_detected")
    if severe_negative_hits:
        score -= 60
        blockers.append("severe_irrelevance_terms_detected")
    if isinstance(page_count, int) and page_count <= 2 and strong_plan_hits == 0:
        score -= 20
        blockers.append("very_short_without_strong_plan_terms")
    if text_characters < 500 and collection.get("status") == "collection_complete_primary_human_review_pending":
        score -= 20
        blockers.append("insufficient_extracted_text")

    score = max(-100, min(100, score))
    if severe_negative_hits or score < 25:
        classification = "probable_wrong_document"
    elif score < 55:
        classification = "manual_source_relevance_check"
    elif blockers:
        classification = "manual_source_relevance_check"
    else:
        classification = "primary_review_candidate"

    return {
        "score": score,
        "classification": classification,
        "reasons": reasons,
        "blockers": sorted(set(blockers)),
        "signals": {
            "strongPlanHits": strong_plan_hits,
            "planHits": plan_hits,
            "metricHits": metric_hits,
            "strategyHits": strategy_hits,
            "yearHits": year_hits,
            "negativeHits": negative_hits,
            "severeNegativeHits": severe_negative_hits,
            "pageCount": page_count,
            "textCharacters": text_characters,
        },
    }


def audit_company_dir(company_dir: Path) -> dict[str, Any] | None:
    collection_path = company_dir / "collection.json"
    if not collection_path.exists():
        return None
    collection = read_json(collection_path)
    status = collection.get("status")
    company = collection.get("company") or {}
    base = {
        "order": collection.get("order"),
        "code": str(company.get("code", company_dir.name)),
        "name": company.get("name"),
        "collectionStatus": status,
        "sourceUrl": company.get("sourceUrl"),
        "resolvedPdfUrl": collection.get("resolvedPdfUrl"),
        "documentTypeCandidate": collection.get("documentTypeCandidate"),
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": False,
    }

    if status == "collection_failed":
        return {
            **base,
            "relevanceClassification": "source_recovery_required",
            "relevanceScore": None,
            "errorType": collection.get("errorType"),
            "error": collection.get("error"),
        }
    if status == "pdf_not_found":
        return {
            **base,
            "relevanceClassification": "pdf_identification_required",
            "relevanceScore": None,
        }
    if status != "collection_complete_primary_human_review_pending":
        return {
            **base,
            "relevanceClassification": "manual_status_review_required",
            "relevanceScore": None,
        }

    full_text_path = company_dir / "full-text.txt"
    full_text = full_text_path.read_text(encoding="utf-8", errors="replace") if full_text_path.exists() else ""
    result = score_packet(collection, full_text)
    return {
        **base,
        "relevanceClassification": result["classification"],
        "relevanceScore": result["score"],
        "reasons": result["reasons"],
        "blockers": result["blockers"],
        "signals": result["signals"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection-root", type=Path, default=COLLECTION_ROOT)
    parser.add_argument("--output-root", type=Path, default=OUTPUT_ROOT)
    args = parser.parse_args()

    rows: list[dict[str, Any]] = []
    for collection_path in sorted(args.collection_root.glob("batch-*/wave-*/*/collection.json")):
        row = audit_company_dir(collection_path.parent)
        if row:
            rows.append(row)

    if len(rows) != 450:
        raise SystemExit(f"expected 450 collection packets, found {len(rows)}")
    codes = [row["code"] for row in rows]
    if len(set(codes)) != 450:
        raise SystemExit("company code uniqueness failure")

    rows.sort(key=lambda row: (row.get("order") or 999999, row["code"]))
    counts = Counter(row["relevanceClassification"] for row in rows)

    queues = {
        "primary-review-candidates.json": [
            row for row in rows if row["relevanceClassification"] == "primary_review_candidate"
        ],
        "manual-source-relevance-check.json": [
            row for row in rows if row["relevanceClassification"] == "manual_source_relevance_check"
        ],
        "probable-wrong-document.json": [
            row for row in rows if row["relevanceClassification"] == "probable_wrong_document"
        ],
        "pdf-identification-required.json": [
            row for row in rows if row["relevanceClassification"] == "pdf_identification_required"
        ],
        "source-recovery-required.json": [
            row for row in rows if row["relevanceClassification"] == "source_recovery_required"
        ],
    }

    for filename, items in queues.items():
        write_json(
            args.output_root / filename,
            {
                "schemaVersion": "phase2-source-relevance-queue-v1",
                "queue": filename.removesuffix(".json"),
                "count": len(items),
                "automaticApprovalAllowed": False,
                "deepVerificationApproved": 0,
                "companies": items,
            },
        )

    summary = {
        "schemaVersion": "phase2-source-relevance-audit-v1",
        "collectionPacketsAudited": len(rows),
        "uniqueCompanies": len(set(codes)),
        "counts": dict(sorted(counts.items())),
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": 0,
        "knownQualityFinding": {
            "code": "4063",
            "expectedClassification": "probable_wrong_document",
            "reason": "holiday notice PDF must not enter primary review",
        },
    }
    write_json(args.output_root / "summary.json", summary)

    known = next((row for row in rows if row["code"] == "4063"), None)
    if known and known["relevanceClassification"] != "probable_wrong_document":
        raise SystemExit("known false-positive guard failed for 4063")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
