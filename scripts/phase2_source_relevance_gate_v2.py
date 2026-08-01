#!/usr/bin/env python3
"""Reclassify Phase 2 collection packets before primary human review.

This gate never approves a company. It only separates likely relevant source
packets from packets that require source repair, PDF identification, visual/OCR
review, or a human relevance decision.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
COLLECTION_ROOT = ROOT / "operations" / "quality-rebase" / "phase2" / "bulk-collection"
OUT_ROOT = ROOT / "operations" / "quality-rebase" / "phase2" / "source-relevance-v2"

PLAN_PATTERNS = [
    (re.compile(r"中期経営計画|中長期経営計画|経営計画"), 8),
    (re.compile(r"事業計画及び成長可能性"), 7),
    (re.compile(r"経営戦略|経営方針|価値創造"), 4),
    (re.compile(r"mid[-\s]?term|management\s+plan|business\s+plan", re.I), 7),
]
METRIC_PATTERN = re.compile(
    r"売上|売上収益|営業利益|事業利益|経常利益|当期利益|純利益|"
    r"ROE|ROIC|ROA|DOE|EBITDA|EPS|配当|総還元性向|投資|"
    r"キャッシュフロー|D/E|自己資本比率",
    re.I,
)
STRATEGY_PATTERN = re.compile(
    r"重点戦略|基本戦略|成長戦略|事業戦略|ポートフォリオ|構造改革|"
    r"DX|M&A|研究開発|人材戦略|サステナビリティ|資本政策|"
    r"キャッシュアロケーション",
    re.I,
)
YEAR_PATTERN = re.compile(r"20\d{2}(?:年度|年|年\d{1,2}月期)|FY\s*20\d{2}", re.I)
NUMBER_PATTERN = re.compile(r"\d[\d,]*(?:\.\d+)?\s*(?:兆円|億円|百万円|%|％|倍)")
NEGATIVE_PATTERN = re.compile(
    r"休日のお知らせ|休業のお知らせ|夏季休業|年末年始休業|採用情報|"
    r"募集要項|会社説明会|定時株主総会招集通知|議決権行使|定款|"
    r"コーポレートガバナンス報告書|株主優待|臨時報告書",
    re.I,
)
KNOWN_FALSE_POSITIVE_CODES = {"4063"}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_text(company_dir: Path, collection: dict[str, Any]) -> str:
    parts: list[str] = []
    company = collection.get("company") or {}
    for value in (
        company.get("name"),
        company.get("document"),
        collection.get("htmlTitle"),
        collection.get("documentTypeCandidate"),
    ):
        if value:
            parts.append(str(value))
    for filename in ("full-text.txt", "source-page-text.txt"):
        path = company_dir / filename
        if path.exists():
            parts.append(path.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(parts)


def relevance_score(text: str, collection: dict[str, Any]) -> tuple[int, list[str], list[str]]:
    score = 0
    positive: list[str] = []
    negative: list[str] = []
    sample = text[:250_000]

    for pattern, points in PLAN_PATTERNS:
        if pattern.search(sample):
            score += points
            positive.append(f"plan_language:+{points}")
    metric_hits = len(METRIC_PATTERN.findall(sample))
    if metric_hits:
        points = min(6, 1 + metric_hits // 8)
        score += points
        positive.append(f"metrics:+{points}")
    strategy_hits = len(STRATEGY_PATTERN.findall(sample))
    if strategy_hits:
        points = min(5, 1 + strategy_hits // 8)
        score += points
        positive.append(f"strategy:+{points}")
    year_hits = len(YEAR_PATTERN.findall(sample))
    if year_hits:
        points = min(4, 1 + year_hits // 5)
        score += points
        positive.append(f"years:+{points}")
    number_hits = len(NUMBER_PATTERN.findall(sample))
    if number_hits:
        points = min(5, 1 + number_hits // 10)
        score += points
        positive.append(f"quantitative:+{points}")

    page_count = int(collection.get("pageCount") or 0)
    text_chars = int(collection.get("textCharacters") or 0)
    if page_count >= 8:
        score += 2
        positive.append("page_count:+2")
    elif page_count and page_count <= 2:
        score -= 4
        negative.append("very_short_pdf:-4")
    if text_chars >= 8_000:
        score += 2
        positive.append("text_volume:+2")
    elif collection.get("resolvedPdfUrl") and text_chars < 400:
        score -= 3
        negative.append("image_or_empty_pdf:-3")

    negative_hits = NEGATIVE_PATTERN.findall(sample[:20_000])
    if negative_hits:
        penalty = min(20, 10 + len(negative_hits) * 2)
        score -= penalty
        negative.append(f"non_plan_document:-{penalty}")

    return score, positive, negative


def classify(company_dir: Path, collection: dict[str, Any]) -> dict[str, Any]:
    company = collection.get("company") or {}
    code = str(company.get("code") or company_dir.name)
    status = collection.get("status")
    text = load_text(company_dir, collection)
    score, positive, negative = relevance_score(text, collection)

    if status == "collection_failed":
        queue = "source_recovery_required"
        reason = "collection_failed"
    elif status == "pdf_not_found" or collection.get("requiresManualPdfIdentification"):
        queue = "pdf_identification_required"
        reason = "pdf_not_found"
    elif collection.get("resolvedPdfUrl") and int(collection.get("textCharacters") or 0) < 400:
        queue = "visual_or_ocr_review_required"
        reason = "pdf_has_insufficient_extractable_text"
    elif NEGATIVE_PATTERN.search(text[:20_000]) or score < 0:
        queue = "likely_wrong_document"
        reason = "negative_document_signals"
    elif score >= 15:
        queue = "primary_review_candidate"
        reason = "strong_relevance_signals"
    else:
        queue = "human_relevance_review_required"
        reason = "insufficient_relevance_confidence"

    if code in KNOWN_FALSE_POSITIVE_CODES and queue == "primary_review_candidate":
        raise SystemExit(
            f"known false-positive regression: {code} was promoted to primary_review_candidate"
        )

    return {
        "code": code,
        "name": company.get("name"),
        "batch": collection.get("batch"),
        "wave": collection.get("wave"),
        "order": collection.get("order"),
        "collectionStatus": status,
        "resolvedPageUrl": collection.get("resolvedPageUrl"),
        "resolvedPdfUrl": collection.get("resolvedPdfUrl"),
        "documentTypeCandidate": collection.get("documentTypeCandidate"),
        "pageCount": collection.get("pageCount"),
        "textCharacters": collection.get("textCharacters"),
        "relevanceScore": score,
        "positiveSignals": positive,
        "negativeSignals": negative,
        "queue": queue,
        "reason": reason,
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection-root", type=Path, default=COLLECTION_ROOT)
    parser.add_argument("--output-root", type=Path, default=OUT_ROOT)
    args = parser.parse_args()

    collection_paths = sorted(args.collection_root.glob("batch-*/wave-*/*/collection.json"))
    rows = [classify(path.parent, read_json(path)) for path in collection_paths]
    codes = [row["code"] for row in rows]
    if len(rows) != 450:
        raise SystemExit(f"expected 450 collection records, found {len(rows)}")
    if len(set(codes)) != 450:
        duplicates = sorted(code for code, count in Counter(codes).items() if count > 1)
        raise SystemExit(f"duplicate company codes: {duplicates}")

    queues: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        queues.setdefault(row["queue"], []).append(row)
    for queue_name, queue_rows in queues.items():
        write_json(args.output_root / f"{queue_name}.json", {
            "schemaVersion": "phase2-source-relevance-queue-v2",
            "queue": queue_name,
            "count": len(queue_rows),
            "companies": queue_rows,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": 0,
        })

    summary = {
        "schemaVersion": "phase2-source-relevance-summary-v2",
        "targetCompanies": 450,
        "auditedCompanies": len(rows),
        "uniqueCompanies": len(set(codes)),
        "counts": dict(sorted(Counter(row["queue"] for row in rows).items())),
        "knownFalsePositiveRegressionCodes": sorted(KNOWN_FALSE_POSITIVE_CODES),
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": 0,
    }
    write_json(args.output_root / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
