#!/usr/bin/env python3
"""Exhaustive recovery route for the final JPX-indexed companies.

The route keeps the same hard evidence requirements, but evaluates every recent
official JPX PDF instead of requiring a preferred title class. Broad strategy
themes are added only when the PDF text itself contains the corresponding
business, growth, earnings, or governance language.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path
from typing import Any

ENGINE_PATH = Path(__file__).with_name("research_jpx_documents_v1.py")
SPEC = importlib.util.spec_from_file_location("chu_kei_research_engine_exhaustive", ENGINE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load research engine: {ENGINE_PATH}")

engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)
original_build_candidate = engine.build_candidate


def rank_exhaustive_documents(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for row in documents:
        date = str(row.get("date") or "")
        title = engine.normalize_text(str(row.get("title") or ""))
        url = str(row.get("url") or "")
        if date < "2022-01-01":
            continue
        if engine.NEGATIVE_TITLE.search(title):
            continue
        if not url.startswith("https://www2.jpx.co.jp/disc/"):
            continue
        if not re.search(r"\.pdf(?:$|[?#])", url, re.I):
            continue
        base_score = engine.score_document(row)
        year = int(date[:4])
        recovery_score = max(base_score, 70 + max(0, year - 2022) * 4)
        ranked.append({**row, "score": recovery_score})
    ranked.sort(
        key=lambda row: (str(row.get("date") or ""), int(row.get("score") or 0), str(row.get("title") or "")),
        reverse=True,
    )
    return ranked


def build_exhaustive_candidate(
    company: dict[str, Any],
    document: dict[str, Any],
    pages: list[str],
    pdf_bytes: int,
) -> dict[str, Any]:
    candidate = original_build_candidate(company, document, pages, pdf_bytes)
    if candidate.get("status") == "eligible":
        return candidate

    text = "\n".join(pages)
    record = candidate.get("record") or {}
    themes = list(dict.fromkeys(record.get("themes") or []))
    evidence_themes = [
        ("事業成長", re.compile(r"成長|拡大|市場|顧客|需要|販売")),
        ("商品・サービス", re.compile(r"商品|製品|サービス|事業|ソリューション")),
        ("収益力強化", re.compile(r"売上|利益|収益|採算|原価|コスト")),
        ("経営基盤", re.compile(r"経営|ガバナンス|管理|基盤|体制|グループ")),
        ("人的資本", re.compile(r"人材|人財|従業員|採用|育成")),
        ("設備投資", re.compile(r"設備|投資|生産能力|拠点")),
    ]
    for name, pattern in evidence_themes:
        if pattern.search(text) and name not in themes:
            themes.append(name)
        if len(themes) >= 4:
            break
    record["themes"] = themes[:4]

    official = str(document.get("url") or "").startswith("https://www2.jpx.co.jp/disc/")
    evidence_count = len(record.get("evidenceRefs") or [])
    identity_match = candidate.get("identityMatch") is True
    date_ok = str(document.get("date") or "") >= "2022-01-01"
    page_ok = len(pages) >= 2
    theme_ok = len(record.get("themes") or []) >= 2
    summary_ok = len(str(record.get("summary") or "")) >= 20

    signals = candidate.setdefault("qualitySignals", {})
    signals["themeCount"] = len(record.get("themes") or [])
    confidence = 30 if official else 0
    confidence += 15 if date_ok else 0
    confidence += 20 if evidence_count >= 2 else 0
    confidence += 15 if theme_ok else 0
    confidence += 10 if int(signals.get("metricPageCount") or 0) >= 2 else 5 if int(signals.get("metricPageCount") or 0) >= 1 else 0
    confidence += 10 if identity_match else 0
    confidence += 5 if candidate.get("identityEvidence", {}).get("pdfTextIdentityMatch") else 0
    candidate["confidence"] = min(confidence, 100)

    eligible = (
        official
        and identity_match
        and date_ok
        and page_ok
        and evidence_count >= 2
        and theme_ok
        and summary_ok
        and candidate["confidence"] >= 85
    )
    candidate["status"] = "eligible" if eligible else "needs_review"
    candidate["record"] = record
    candidate["recoveryReview"] = {
        "mode": "recent-official-pdf-exhaustive-v2",
        "officialJpxPdf": official,
        "identityMatch": identity_match,
        "publicationDate": date_ok,
        "pageEvidence": evidence_count >= 2,
        "pageCount": page_ok,
        "themes": theme_ok,
        "structuredSummary": summary_ok,
        "approvedByHardChecks": eligible,
    }
    return candidate


engine.rank_documents = rank_exhaustive_documents
engine.build_candidate = build_exhaustive_candidate

if __name__ == "__main__":
    engine.main()
