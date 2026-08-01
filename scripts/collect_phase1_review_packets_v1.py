from __future__ import annotations

import argparse
import gzip
import hashlib
import ipaddress
import json
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
COHORT_PATH = ROOT / "operations" / "quality-rebase" / "phase1-cohort-50-v1.json"
OUTPUT_DIR = ROOT / "artifacts" / "quality-rebase" / "phase1-review-packets"
SUMMARY_PATH = ROOT / "artifacts" / "quality-rebase" / "phase1-review-packets-summary-v1.json"
USER_AGENT = "Chu-kei-Phase1-Review-Collector/1.0 (+https://github.com/M-Osugi1230/chu-kei)"
MAX_BYTES = 60 * 1024 * 1024
TIMEOUT_SECONDS = 30
MAX_PDF_CANDIDATES = 20
MAX_PAGE_TEXT_CHARS = 16000
REQUEST_DELAY_SECONDS = 0.25

PLAN_KEYWORDS = [
    "中期経営計画",
    "中長期経営計画",
    "中期経営戦略",
    "中長期経営戦略",
    "経営計画",
    "経営戦略",
    "事業計画",
    "成長戦略",
    "management plan",
    "medium-term",
    "mid-term",
]

SECTION_KEYWORDS = {
    "vision": ["ビジョン", "目指す姿", "ありたい姿", "長期ビジョン", "Vision"],
    "strategy": ["基本戦略", "重点戦略", "成長戦略", "事業戦略", "戦略方針"],
    "financial_targets": ["財務目標", "経営目標", "定量目標", "数値目標", "KPI"],
    "revenue": ["売上高", "売上収益", "営業収益"],
    "profit": ["営業利益", "事業利益", "経常利益", "当期利益", "EBITDA"],
    "capital_efficiency": ["ROIC", "ROE", "資本コスト", "WACC", "PBR"],
    "capital_allocation": ["キャッシュアロケーション", "資本配分", "成長投資", "投資計画"],
    "shareholder_return": ["株主還元", "配当性向", "DOE", "自己株式取得", "総還元性向"],
    "business_portfolio": ["事業ポートフォリオ", "ポートフォリオ改革", "選択と集中"],
    "human_capital": ["人的資本", "人材戦略", "従業員エンゲージメント"],
    "sustainability": ["サステナビリティ", "脱炭素", "GX", "ESG"],
    "digital": ["DX", "デジタル", "AI", "データ活用"],
    "risk": ["リスク", "前提条件", "課題", "不確実性"],
}

METRIC_PATTERNS = [
    ("revenue", re.compile(r"(?:売上高|売上収益|営業収益)\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(兆円|億円|百万円|千円|円)?")),
    ("operating_profit", re.compile(r"(?:営業利益|事業利益)\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(億円|百万円|千円|円)?")),
    ("ordinary_profit", re.compile(r"経常利益\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(億円|百万円|千円|円)?")),
    ("net_income", re.compile(r"(?:当期純利益|当期利益|親会社株主に帰属する当期利益)\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(億円|百万円|千円|円)?")),
    ("ebitda", re.compile(r"EBITDA\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(億円|百万円|千円|円)?", re.I)),
    ("roe", re.compile(r"ROE\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(%|％)?", re.I)),
    ("roic", re.compile(r"ROIC\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(%|％)?", re.I)),
    ("operating_margin", re.compile(r"(?:営業利益率|事業利益率)\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(%|％)?")),
    ("payout_ratio", re.compile(r"配当性向\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(%|％)?")),
    ("doe", re.compile(r"DOE\s*[:：]?\s*([0-9][0-9,\.]*)(?:\s*)(%|％)?", re.I)),
]

YEAR_PATTERN = re.compile(r"(?:20\d{2}|FY\s*\d{2,4}|\d{4}年度)", re.I)


@dataclass
class DownloadResult:
    body: bytes
    final_url: str
    content_type: str
    status: int
    headers: dict[str, str | None]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=1, help="1-based cohort order")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR))
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_filename(value: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-z._-]+", "-", value).strip("-")
    return normalized[:120] or "file"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def is_public_host(hostname: str) -> bool:
    if not hostname or hostname == "localhost" or hostname.endswith(".local"):
        return False
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(hostname, None)}
    except socket.gaierror:
        return False
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def validate_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("Only HTTPS source URLs are permitted")
    if parsed.username or parsed.password:
        raise ValueError("Credentials in source URL are prohibited")
    if not is_public_host(parsed.hostname or ""):
        raise ValueError("Source URL must resolve to a public host")
    return url


def download(url: str) -> DownloadResult:
    validate_url(url)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/pdf,text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "ja,en;q=0.5",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        final_url = validate_url(response.geturl())
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > MAX_BYTES:
            raise RuntimeError(f"Response too large: {declared} bytes")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_BYTES:
                raise RuntimeError("Response exceeded maximum size")
            chunks.append(chunk)
        return DownloadResult(
            body=b"".join(chunks),
            final_url=final_url,
            content_type=response.headers.get_content_type(),
            status=getattr(response, "status", 200),
            headers={
                "contentLength": declared,
                "lastModified": response.headers.get("Last-Modified"),
                "etag": response.headers.get("ETag"),
            },
        )


def decode_html(body: bytes) -> str:
    for encoding in ("utf-8", "shift_jis", "cp932", "euc_jp"):
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", errors="replace")


def strip_html(html: str) -> str:
    without_script = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    without_tags = re.sub(r"<[^>]+>", " ", without_script)
    return re.sub(r"\s+", " ", without_tags).strip()


def html_title(html: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not match:
        return None
    return strip_html(match.group(1))[:300]


def extract_links(html: str, base_url: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    for match in re.finditer(
        r"<a\b[^>]*href\s*=\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a>",
        html,
        re.I | re.S,
    ):
        href = urllib.parse.urljoin(base_url, match.group(1))
        label = strip_html(match.group(2))[:300]
        parsed = urllib.parse.urlparse(href)
        if parsed.scheme != "https":
            continue
        links.append({"url": href, "label": label})
    return links


def score_pdf_candidate(link: dict[str, str], expected_document: str) -> int:
    url = link["url"]
    label = link["label"]
    text = f"{url} {label} {expected_document}".casefold()
    score = 0
    if urllib.parse.urlparse(url).path.casefold().endswith(".pdf"):
        score += 50
    if "pdf" in urllib.parse.urlparse(url).query.casefold():
        score += 20
    for keyword in PLAN_KEYWORDS:
        if keyword.casefold() in text:
            score += 20
    expected_tokens = [token for token in re.split(r"[\s~～・()/（）_-]+", expected_document) if len(token) >= 3]
    for token in expected_tokens:
        if token.casefold() in text:
            score += 3
    if any(word in text for word in ["決算短信", "earnings release", "有価証券報告書"]):
        score -= 40
    return score


def choose_pdf_candidate(html: str, base_url: str, expected_document: str) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    candidates = []
    for link in extract_links(html, base_url):
        parsed = urllib.parse.urlparse(link["url"])
        if not (parsed.path.casefold().endswith(".pdf") or "pdf" in parsed.query.casefold()):
            continue
        candidate = {**link, "score": score_pdf_candidate(link, expected_document)}
        candidates.append(candidate)
    candidates.sort(key=lambda item: (-item["score"], item["url"]))
    top = candidates[0] if candidates and candidates[0]["score"] > 0 else None
    return candidates[:MAX_PDF_CANDIDATES], top


def parse_pdf(body: bytes, work_dir: Path) -> dict[str, Any]:
    pdf_path = work_dir / "source.pdf"
    text_path = work_dir / "source.txt"
    pdf_path.write_bytes(body)

    info = subprocess.run(
        ["pdfinfo", str(pdf_path)],
        text=True,
        capture_output=True,
        timeout=45,
        check=False,
    )
    metadata: dict[str, str] = {}
    if info.returncode == 0:
        for line in info.stdout.splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                metadata[key.strip()] = value.strip()

    extract = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), str(text_path)],
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    raw_text = text_path.read_text(encoding="utf-8", errors="replace") if extract.returncode == 0 and text_path.exists() else ""
    pages = raw_text.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()

    return {
        "metadata": metadata,
        "pageCount": len(pages) or int(metadata.get("Pages", "0") or 0),
        "pages": pages,
        "pdftotextReturnCode": extract.returncode,
        "pdftotextError": extract.stderr.strip()[:2000] if extract.returncode else None,
    }


def keyword_hits(page_text: str) -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {}
    folded = page_text.casefold()
    for section, keywords in SECTION_KEYWORDS.items():
        found = [keyword for keyword in keywords if keyword.casefold() in folded]
        if found:
            hits[section] = found
    return hits


def metric_candidates(page_text: str, page_number: int) -> list[dict[str, Any]]:
    compact = re.sub(r"[\t ]+", " ", page_text)
    candidates: list[dict[str, Any]] = []
    for metric, pattern in METRIC_PATTERNS:
        for match in pattern.finditer(compact):
            context_start = max(0, match.start() - 100)
            context_end = min(len(compact), match.end() + 160)
            context = re.sub(r"\s+", " ", compact[context_start:context_end]).strip()
            years = YEAR_PATTERN.findall(context)
            candidates.append({
                "metric": metric,
                "valueText": match.group(1),
                "unit": match.group(2) if match.lastindex and match.lastindex >= 2 else None,
                "page": page_number,
                "yearsInContext": years[:5],
                "context": context[:500],
                "requiresHumanValidation": True,
            })
    return candidates[:100]


def build_page_records(pages: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    page_records: list[dict[str, Any]] = []
    all_metrics: list[dict[str, Any]] = []
    for page_number, page_text in enumerate(pages, start=1):
        normalized = page_text.replace("\x00", "").strip()
        hits = keyword_hits(normalized)
        metrics = metric_candidates(normalized, page_number)
        all_metrics.extend(metrics)
        page_records.append({
            "page": page_number,
            "text": normalized[:MAX_PAGE_TEXT_CHARS],
            "textTruncated": len(normalized) > MAX_PAGE_TEXT_CHARS,
            "sectionKeywordHits": hits,
            "metricCandidateCount": len(metrics),
            "sha256": sha256_bytes(normalized.encode("utf-8")),
        })
    return page_records, all_metrics


def plan_relevance(document: str, pages: list[str]) -> dict[str, Any]:
    first_pages = "\n".join(pages[:8])
    folded = first_pages.casefold()
    hits = [keyword for keyword in PLAN_KEYWORDS if keyword.casefold() in folded]
    document_tokens = [token for token in re.split(r"[\s~～・()/（）_-]+", document) if len(token) >= 3]
    document_hits = [token for token in document_tokens if token.casefold() in folded]
    return {
        "planKeywordHits": hits,
        "documentTokenHits": document_hits[:20],
        "likelyFormalPlan": bool(hits) and len(document_hits) >= 1,
        "requiresHumanConfirmation": True,
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_gzip_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9, mtime=0) as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))


def review_template(company: dict[str, Any], packet_file: str | None) -> dict[str, Any]:
    return {
        "schemaVersion": "quality-rebase-phase1-human-review-v1",
        "company": {
            "order": company["order"],
            "code": company["code"],
            "name": company["name"],
        },
        "packetFile": packet_file,
        "status": "not_started",
        "reviewers": [],
        "checks": {
            "formalPlanConfirmed": None,
            "fullTextReviewed": None,
            "strategyStructured": None,
            "metricsValidated": None,
            "evidenceLinked": None,
            "independentDoubleCheck": None,
        },
        "structuredFields": {
            "planPeriod": None,
            "vision": None,
            "strategies": [],
            "financialTargets": [],
            "nonFinancialTargets": [],
            "capitalAllocation": None,
            "shareholderReturn": None,
            "businessPortfolio": None,
            "risksAndAssumptions": [],
        },
        "fieldEvidence": [],
        "metricValidation": [],
        "reviewNotes": [],
        "approval": {
            "automaticApprovalAllowed": False,
            "approved": False,
            "approvedAt": None,
        },
    }


def collect_company(company: dict[str, Any], output_dir: Path, dry_run: bool) -> dict[str, Any]:
    code = str(company["code"])
    prefix = f"{int(company['order']):02d}-{safe_filename(code)}"
    packet_path = output_dir / f"{prefix}-packet.json.gz"
    review_path = output_dir / f"{prefix}-review.json"
    result: dict[str, Any] = {
        "order": company["order"],
        "code": code,
        "name": company["name"],
        "sourceUrl": company["sourceUrl"],
        "document": company["document"],
        "status": "dry_run" if dry_run else "pending",
        "packetFile": packet_path.name,
        "reviewFile": review_path.name,
        "automaticApprovalAllowed": False,
    }
    if dry_run:
        write_json(review_path, review_template(company, packet_path.name))
        return result

    try:
        source = download(company["sourceUrl"])
        is_pdf = source.content_type == "application/pdf" or source.body.startswith(b"%PDF")
        discovery: dict[str, Any] = {
            "requestedUrl": company["sourceUrl"],
            "initialFinalUrl": source.final_url,
            "initialContentType": source.content_type,
            "initialStatus": source.status,
            "initialHeaders": source.headers,
            "pdfCandidates": [],
        }
        pdf_source = source
        if not is_pdf:
            html = decode_html(source.body)
            candidates, selected = choose_pdf_candidate(html, source.final_url, company["document"])
            discovery["htmlTitle"] = html_title(html)
            discovery["pdfCandidates"] = candidates
            if not selected:
                raise RuntimeError("No relevant official PDF candidate found on source page")
            discovery["selectedPdfCandidate"] = selected
            time.sleep(REQUEST_DELAY_SECONDS)
            pdf_source = download(selected["url"])
            if not (pdf_source.content_type == "application/pdf" or pdf_source.body.startswith(b"%PDF")):
                raise RuntimeError("Selected official source candidate is not a PDF")

        with tempfile.TemporaryDirectory() as directory:
            parsed = parse_pdf(pdf_source.body, Path(directory))
        page_records, metrics = build_page_records(parsed["pages"])
        packet = {
            "schemaVersion": "quality-rebase-phase1-review-packet-v1",
            "collectedAt": utc_now(),
            "company": company,
            "policy": {
                "candidateOnly": True,
                "automaticFactCompletionAllowed": False,
                "automaticDeepApprovalAllowed": False,
                "humanFullTextReviewRequired": True,
                "independentDoubleCheckRequired": True,
            },
            "source": {
                **discovery,
                "pdfFinalUrl": pdf_source.final_url,
                "pdfContentType": pdf_source.content_type,
                "pdfStatus": pdf_source.status,
                "pdfHeaders": pdf_source.headers,
                "pdfBytes": len(pdf_source.body),
                "pdfSha256": sha256_bytes(pdf_source.body),
            },
            "pdf": {
                "metadata": parsed["metadata"],
                "pageCount": parsed["pageCount"],
                "pdftotextReturnCode": parsed["pdftotextReturnCode"],
                "pdftotextError": parsed["pdftotextError"],
                "relevance": plan_relevance(company["document"], parsed["pages"]),
                "pages": page_records,
            },
            "metricCandidates": metrics,
            "humanReviewRequired": {
                "formalPlanConfirmation": True,
                "allPagesRead": list(range(1, parsed["pageCount"] + 1)),
                "fieldEvidenceRequired": True,
                "yearUnitScopeValidationRequired": True,
                "secondReviewerRequired": True,
            },
        }
        write_gzip_json(packet_path, packet)
        write_json(review_path, review_template(company, packet_path.name))
        result.update({
            "status": "collected",
            "pdfFinalUrl": pdf_source.final_url,
            "pdfSha256": packet["source"]["pdfSha256"],
            "pageCount": parsed["pageCount"],
            "metricCandidateCount": len(metrics),
            "likelyFormalPlan": packet["pdf"]["relevance"]["likelyFormalPlan"],
        })
    except Exception as error:  # noqa: BLE001
        write_json(review_path, review_template(company, None))
        result.update({
            "status": "failed",
            "error": f"{type(error).__name__}: {error}"[:2000],
        })
    return result


def main() -> int:
    args = parse_args()
    if not args.dry_run and (not shutil.which("pdfinfo") or not shutil.which("pdftotext")):
        raise RuntimeError("poppler-utils is required")

    cohort = json.loads(COHORT_PATH.read_text(encoding="utf-8"))
    companies = cohort["companies"]
    start_index = max(0, args.start - 1)
    selected = companies[start_index:start_index + max(0, args.limit)]
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for index, company in enumerate(selected):
        if index:
            time.sleep(REQUEST_DELAY_SECONDS)
        results.append(collect_company(company, output_dir, args.dry_run))

    summary = {
        "schemaVersion": "quality-rebase-phase1-review-packets-summary-v1",
        "generatedAt": utc_now(),
        "mode": "dry_run" if args.dry_run else "live",
        "range": {
            "start": args.start,
            "limit": args.limit,
            "selected": len(selected),
        },
        "policy": {
            "automaticFactCompletionAllowed": False,
            "automaticDeepApprovalAllowed": False,
            "humanFullTextReviewRequired": True,
            "minimumReviewers": 2,
        },
        "counts": {
            "collected": sum(item["status"] == "collected" for item in results),
            "failed": sum(item["status"] == "failed" for item in results),
            "dryRun": sum(item["status"] == "dry_run" for item in results),
        },
        "results": results,
    }
    write_json(SUMMARY_PATH, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["counts"]["failed"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
