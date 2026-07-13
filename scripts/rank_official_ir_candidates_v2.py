#!/usr/bin/env python3
"""Rank official IR PDF candidates without retaining PDF binaries."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import requests
from pypdf import PdfReader

POSITIVE = re.compile(
    r"中期|長期|経営計画|成長可能性|決算説明|統合報告|financial|presentation|strategy|plan|vision|"
    r"売上高|売上収益|営業収益|ARR|営業利益|EBITDA|ROE|ROIC|設備投資|成長投資|研究開発|M&A|配当|DOE|"
    r"2030|2029|2028|2027|2026",
    re.I,
)
NEGATIVE = re.compile(r"招集通知|株主総会|定款|大量保有|月次売上|人事異動|自己株式の取得状況", re.I)
PAGE_SIGNAL = re.compile(
    r"売上高|売上収益|営業収益|ARR|営業利益|経常利益|EBITDA|ROE|ROIC|設備投資|成長投資|研究開発|"
    r"M&A|配当性向|DOE|自己株式|202[6-9]|2030",
    re.I,
)
COMMON_IR_HOSTS = {
    "contents.xj-storage.jp",
    "ssl4.eir-parts.net",
    "pdf.irpocket.com",
    "disclosure2dl.edinet-fsa.go.jp",
}


@dataclass(frozen=True)
class Candidate:
    url: str
    anchor_text: str
    link_score: int


def official_url(url: str, start_url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    start_host = (urlparse(start_url).hostname or "").lower()
    return host == start_host or host.endswith(f".{start_host}") or host in COMMON_IR_HOSTS


def link_score(text: str, url: str) -> int:
    combined = f"{text} {url}"
    score = len(POSITIVE.findall(combined)) * 6 - len(NEGATIVE.findall(combined)) * 20
    if re.search(r"中期|経営計画|成長可能性|strategy|plan|vision", combined, re.I):
        score += 30
    if re.search(r"決算説明|presentation|統合報告", combined, re.I):
        score += 20
    if re.search(r"2026|2027|2028|2029|2030", combined):
        score += 12
    if ".pdf" in url.lower():
        score += 5
    return score


def collect_candidates(company: dict, maximum: int) -> list[Candidate]:
    ranked: dict[str, Candidate] = {}
    start_url = company["startUrl"]
    for page in company.get("pages", []):
        for link in page.get("links", []):
            url = link.get("href", "")
            text = link.get("text", "")
            if not url or ".pdf" not in url.lower() or not official_url(url, start_url):
                continue
            candidate = Candidate(url=url, anchor_text=text, link_score=link_score(text, url))
            previous = ranked.get(url)
            if previous is None or candidate.link_score > previous.link_score:
                ranked[url] = candidate
        for response in page.get("responses", []):
            url = response.get("url", "")
            content_type = response.get("contentType", "")
            if not url or ("pdf" not in content_type.lower() and ".pdf" not in url.lower()):
                continue
            if not official_url(url, start_url):
                continue
            candidate = Candidate(url=url, anchor_text="network response", link_score=link_score("", url))
            ranked.setdefault(url, candidate)
    return sorted(ranked.values(), key=lambda row: (-row.link_score, row.url))[:maximum]


def inspect_pdf(session: requests.Session, candidate: Candidate, max_bytes: int, max_pages: int) -> dict:
    response = session.get(candidate.url, timeout=45, allow_redirects=True)
    response.raise_for_status()
    data = response.content
    if len(data) > max_bytes:
        raise ValueError(f"PDF exceeds {max_bytes} bytes")
    if not data.startswith(b"%PDF"):
        raise ValueError("response is not a PDF")

    reader = PdfReader(io.BytesIO(data))
    page_rows: list[dict] = []
    metric_hits = 0
    pages_with_metrics = 0
    for page_number, page in enumerate(reader.pages[:max_pages], 1):
        text = re.sub(r"\s+", " ", (page.extract_text() or "").strip())
        if not text:
            continue
        hits = PAGE_SIGNAL.findall(text)
        if hits:
            pages_with_metrics += 1
            metric_hits += len(hits)
            page_rows.append({"page": page_number, "hits": len(hits), "snippet": text[:1200]})

    evidence_score = candidate.link_score + min(metric_hits, 200) + pages_with_metrics * 3
    return {
        "url": candidate.url,
        "anchorText": candidate.anchor_text,
        "linkScore": candidate.link_score,
        "evidenceScore": evidence_score,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "pageCount": len(reader.pages),
        "inspectedPages": min(len(reader.pages), max_pages),
        "metricHits": metric_hits,
        "evidencePages": page_rows[:12],
        "metadata": {str(key): str(value) for key, value in (reader.metadata or {}).items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--links-report", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-per-company", type=int, default=3)
    parser.add_argument("--max-bytes", type=int, default=30_000_000)
    parser.add_argument("--max-pages", type=int, default=120)
    args = parser.parse_args()

    report = json.loads(args.links_report.read_text(encoding="utf-8"))
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; Chu-kei official evidence audit/4.0)",
        "Accept-Language": "ja,en;q=0.7",
    })

    output: dict[str, dict] = {}
    for code, company in report.items():
        results = []
        for candidate in collect_candidates(company, args.max_per_company):
            try:
                results.append(inspect_pdf(session, candidate, args.max_bytes, args.max_pages))
            except Exception as error:  # noqa: BLE001 - preserve per-document failure details
                results.append({
                    "url": candidate.url,
                    "anchorText": candidate.anchor_text,
                    "linkScore": candidate.link_score,
                    "error": str(error),
                })
        results.sort(key=lambda row: (-row.get("evidenceScore", -1), -row.get("linkScore", -1), row["url"]))
        output[code] = {
            "name": company["name"],
            "startUrl": company["startUrl"],
            "evaluatedDocuments": len(results),
            "candidates": results,
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "companies": len(output),
        "documents": sum(row["evaluatedDocuments"] for row in output.values()),
        "output": str(args.output),
        "pdfBinariesRetained": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
