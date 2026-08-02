#!/usr/bin/env python3
"""Build non-approving evidence packets for assigned Phase 2 reviews.

The output is a review aid only. It never marks full-text review, factual
validation, independent review, or deep verification as complete.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PHASE2 = ROOT / "operations" / "quality-rebase" / "phase2"
OUTPUT_DIR = PHASE2 / "evidence-packets"
ASSIGNED_PREFIX = "primary_review_assigned"

CATEGORY_PATTERNS: dict[str, tuple[str, ...]] = {
    "plan_identity": (
        "中期経営計画",
        "事業計画及び成長可能性",
        "計画期間",
        "基本方針",
    ),
    "financial_targets": (
        "売上高",
        "売上収益",
        "営業利益",
        "経常利益",
        "当期純利益",
        "EBITDA",
        "利益率",
        "ROE",
        "ROIC",
    ),
    "business_kpis": (
        "KPI",
        "会員",
        "ユーザー",
        "顧客",
        "店舗",
        "取引",
        "件数",
        "人数",
    ),
    "capital_policy": (
        "キャピタルアロケーション",
        "資本政策",
        "成長投資",
        "設備投資",
        "研究開発",
        "M&A",
        "資金調達",
        "キャッシュフロー",
    ),
    "shareholder_return": (
        "株主還元",
        "配当",
        "配当性向",
        "総還元性向",
        "自己株式",
        "DOE",
    ),
    "market_forecast": (
        "市場規模",
        "市場予測",
        "CAGR",
        "外部調査",
        "出所",
        "予測",
    ),
    "risk_and_assumptions": (
        "リスク",
        "前提",
        "為替",
        "金利",
        "見通し",
        "想定",
    ),
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def source_directory(review_input: Path) -> Path:
    return review_input.parent


def page_records(metrics: Any) -> list[dict[str, Any]]:
    if not isinstance(metrics, list):
        return []
    result: list[dict[str, Any]] = []
    for item in metrics:
        if not isinstance(item, dict):
            continue
        page = item.get("page")
        text = normalize_space(str(item.get("text", "")))
        if not isinstance(page, int) or not text:
            continue
        result.append(
            {
                "page": page,
                "text": text,
                "numbers": item.get("numbers", []),
                "years": item.get("years", []),
                "requiresHumanValidation": True,
            }
        )
    return result


def categorized_pages(records: list[dict[str, Any]]) -> dict[str, list[int]]:
    categories: dict[str, list[int]] = {key: [] for key in CATEGORY_PATTERNS}
    for record in records:
        text = str(record["text"])
        page = int(record["page"])
        for category, patterns in CATEGORY_PATTERNS.items():
            if any(pattern.lower() in text.lower() for pattern in patterns):
                categories[category].append(page)
    return {
        category: sorted(set(pages))
        for category, pages in categories.items()
        if pages
    }


def ambiguous_numeric_pages(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for record in records:
        text = str(record["text"])
        years = record.get("years", [])
        numbers = record.get("numbers", [])
        reasons: list[str] = []
        if len(years) >= 2:
            reasons.append("multiple_years")
        if any(word in text for word in ("実績", "計画", "目標")) and sum(
            word in text for word in ("実績", "計画", "目標")
        ) >= 2:
            reasons.append("actual_plan_target_mixed")
        if any(word in text for word in ("市場規模", "外部調査", "出所", "CAGR")):
            reasons.append("market_or_external_forecast")
        if len(numbers) >= 8:
            reasons.append("dense_numeric_figure")
        if reasons:
            findings.append(
                {
                    "page": record["page"],
                    "reasons": reasons,
                    "years": years,
                    "numbers": numbers,
                }
            )
    return findings


def build_packet(company: dict[str, Any]) -> dict[str, Any] | None:
    review_input_value = company.get("reviewInput")
    if not isinstance(review_input_value, str):
        return None
    review_input = ROOT / review_input_value
    if not review_input.is_file():
        return None

    template = load_json(review_input)
    directory = source_directory(review_input)
    full_text_path = directory / "full-text.txt"
    metrics_path = directory / "metric-candidates.json"
    if not full_text_path.is_file() or not metrics_path.is_file():
        return None

    full_text = full_text_path.read_text(encoding="utf-8")
    metrics = load_json(metrics_path)
    records = page_records(metrics)
    document = template.get("document", {}) if isinstance(template, dict) else {}

    return {
        "schemaVersion": "phase2-primary-review-evidence-packet-v1",
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "company": {
            "order": company.get("order"),
            "code": str(company.get("code")),
            "name": company.get("name"),
        },
        "waveAssignment": {
            "documentTypeCandidate": company.get("documentTypeCandidate"),
            "relevanceScore": company.get("relevanceScore"),
            "requiredChecks": company.get("requiredChecks", []),
            "reviewInput": review_input_value,
        },
        "source": {
            "candidateTitle": document.get("candidateTitle"),
            "candidatePublishedDate": document.get("candidatePublishedDate"),
            "sourceUrl": document.get("sourceUrl"),
            "resolvedPageUrl": document.get("resolvedPageUrl"),
            "resolvedPdfUrl": document.get("resolvedPdfUrl"),
            "pageCount": document.get("pageCount"),
            "pdfSha256": document.get("pdfSha256"),
            "fullTextSha256": sha256_text(full_text),
        },
        "evidence": {
            "categorizedPages": categorized_pages(records),
            "numericPages": records,
            "ambiguousNumericPages": ambiguous_numeric_pages(records),
        },
        "humanReviewChecklist": [
            "会社名・証券コード・公開日・公式URL・PDFハッシュを確認する",
            "開示資料の外形と正式中期経営計画部分の境界を確認する",
            "実績・予想・計画・長期目標・外部市場予測を分離する",
            "主要数値の年度・単位・連結単体範囲・定義を図表で確認する",
            "資本政策・成長投資・株主還元の開示値と非開示項目を区別する",
            "全ページを読んだ後にのみ一次レビュー完了記録を作成する",
        ],
        "review": {
            "status": "evidence_packet_ready_primary_human_review_pending",
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
            "fullTextHumanReviewComplete": False,
            "independentDoubleCheck": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--wave",
        action="append",
        default=[],
        help="Wave JSON path. Repeat for multiple waves; defaults to all waves.",
    )
    args = parser.parse_args()

    wave_paths = [ROOT / value for value in args.wave] if args.wave else sorted(
        PHASE2.glob("primary-review-wave*-v1.json")
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    generated: list[str] = []
    for wave_path in wave_paths:
        wave = load_json(wave_path)
        for company in wave.get("companies", []):
            if not isinstance(company, dict):
                continue
            if not str(company.get("status", "")).startswith(ASSIGNED_PREFIX):
                continue
            packet = build_packet(company)
            if packet is None:
                continue
            output = OUTPUT_DIR / f"{company['code']}-evidence-v1.json"
            output.write_text(
                json.dumps(packet, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            generated.append(str(output.relative_to(ROOT)))

    print(
        json.dumps(
            {
                "status": "ok",
                "generated": generated,
                "automaticFactCompletionAllowed": False,
                "deepVerificationApproved": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
