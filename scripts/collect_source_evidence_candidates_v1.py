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
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "site" / "data"
ARTIFACT_DIR = ROOT / "artifacts"
USER_AGENT = "Chu-kei-Evidence-Collector/1.0 (+https://github.com/M-Osugi1230/chu-kei)"
MAX_BYTES = 40 * 1024 * 1024
TIMEOUT = 20
KEYWORDS = ["中期経営計画", "売上高", "営業利益", "ROIC", "ROE", "配当性向", "DOE", "株主還元", "M&A", "人的資本"]
DATE_PATTERNS = [
    re.compile(r"(20\d{2})年\s*(1[0-2]|0?[1-9])月\s*(3[01]|[12]\d|0?[1-9])日"),
    re.compile(r"(20\d{2})[./-](1[0-2]|0?[1-9])[./-](3[01]|[12]\d|0?[1-9])"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output", default=str(ARTIFACT_DIR / "source-evidence-candidates-v1.json"))
    return parser.parse_args()


def read_bundle() -> dict:
    manifest = json.loads((DATA_DIR / "bundle.manifest.json").read_text(encoding="utf-8"))
    compressed = b"".join((DATA_DIR / part["file"]).read_bytes() for part in manifest["parts"])
    digest = hashlib.sha256(compressed).hexdigest()
    if digest != manifest["sha256"]:
        raise RuntimeError(f"bundle checksum mismatch: {digest}")
    return json.loads(gzip.decompress(compressed).decode("utf-8"))


def has_page_evidence(company: dict) -> bool:
    return any(re.search(r"(?:p\.?\s*\d|ページ\s*\d)", str(ref), re.I) for ref in company.get("evidenceRefs", []))


def repair_targets(companies: list[dict]) -> list[dict]:
    targets = []
    for company in companies:
        if company.get("stage") != "core":
            continue
        gaps = []
        if not company.get("planPublishedDate"):
            gaps.append("publicationDate")
        if not has_page_evidence(company):
            gaps.append("pageEvidence")
        if gaps:
            targets.append({
                "code": company["code"],
                "name": company["name"],
                "document": company.get("document"),
                "sourceUrl": company.get("sourceUrl"),
                "gaps": gaps,
            })
    return sorted(targets, key=lambda item: ("publicationDate" not in item["gaps"], item["code"]))


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


def safe_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or not is_public_host(parsed.hostname or ""):
        raise ValueError("URL is not an approved public HTTPS source")
    return url


def download(url: str) -> tuple[bytes, dict]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/pdf,*/*;q=0.8"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        final_url = safe_url(response.geturl())
        content_type = response.headers.get_content_type()
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > MAX_BYTES:
            raise RuntimeError(f"response too large: {declared}")
        chunks, total = [], 0
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_BYTES:
                raise RuntimeError("response exceeded maximum size")
            chunks.append(chunk)
        return b"".join(chunks), {
            "finalUrl": final_url,
            "contentType": content_type,
            "status": getattr(response, "status", 200),
            "lastModified": response.headers.get("Last-Modified"),
            "etag": response.headers.get("ETag"),
            "bytes": total,
        }


def html_title(text: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    if not match:
        return None
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", match.group(1))).strip()[:300]


def find_pdf_links(html: str, base_url: str) -> list[str]:
    candidates = []
    for match in re.finditer(r"href\s*=\s*[\"']([^\"']+)[\"']", html, re.I):
        absolute = urllib.parse.urljoin(base_url, match.group(1))
        parsed = urllib.parse.urlparse(absolute)
        if parsed.scheme == "https" and (parsed.path.lower().endswith(".pdf") or "pdf" in parsed.query.lower()):
            candidates.append(absolute)
    return list(dict.fromkeys(candidates))[:10]


def date_candidates(text: str, pages: list[int] | None = None, source: str = "text") -> list[dict]:
    found = []
    for pattern in DATE_PATTERNS:
        for match in pattern.finditer(text):
            year, month, day = map(int, match.groups())
            try:
                value = datetime(year, month, day).date().isoformat()
            except ValueError:
                continue
            page = None
            if pages is not None:
                page = text[: match.start()].count("\f") + 1
            found.append({"value": value, "source": source, "page": page, "raw": match.group(0)})
    unique = []
    seen = set()
    for item in found:
        key = (item["value"], item["source"], item["page"])
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique[:30]


def parse_pdf(data: bytes, work: Path) -> dict:
    pdf_path = work / "source.pdf"
    text_path = work / "source.txt"
    pdf_path.write_bytes(data)
    info = subprocess.run(["pdfinfo", str(pdf_path)], text=True, capture_output=True, timeout=30)
    metadata = {}
    if info.returncode == 0:
        for line in info.stdout.splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                metadata[key.strip()] = value.strip()
    extract = subprocess.run(["pdftotext", "-layout", str(pdf_path), str(text_path)], text=True, capture_output=True, timeout=90)
    text = text_path.read_text(encoding="utf-8", errors="replace") if extract.returncode == 0 and text_path.exists() else ""
    pages = text.split("\f")
    keyword_pages = []
    for index, page_text in enumerate(pages, start=1):
        hits = [keyword for keyword in KEYWORDS if keyword.casefold() in page_text.casefold()]
        if hits:
            keyword_pages.append({"page": index, "keywords": hits, "snippet": re.sub(r"\s+", " ", page_text).strip()[:500]})
    candidates = date_candidates(text, list(range(1, len(pages) + 1)), "pdf_text")
    for field in ["CreationDate", "ModDate"]:
        value = metadata.get(field)
        if value:
            match = re.search(r"(20\d{2})(\d{2})(\d{2})", value)
            if match:
                year, month, day = map(int, match.groups())
                try:
                    candidates.append({"value": datetime(year, month, day).date().isoformat(), "source": f"pdf_{field}", "page": None, "raw": value})
                except ValueError:
                    pass
    return {
        "pdfMetadata": metadata,
        "pageCount": int(metadata.get("Pages", 0)) if metadata.get("Pages", "").isdigit() else len(pages),
        "dateCandidates": candidates,
        "keywordPages": keyword_pages[:50],
        "textExtractionError": extract.stderr.strip()[:1000] if extract.returncode else None,
    }


def inspect_target(target: dict) -> dict:
    result = {**target, "checkedAt": datetime.now(timezone.utc).isoformat(), "status": "pending_review", "automaticUpdateAllowed": False}
    try:
        source_url = safe_url(target["sourceUrl"])
        body, response = download(source_url)
        result["response"] = response
        is_pdf = response["contentType"] == "application/pdf" or body.startswith(b"%PDF")
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            if is_pdf:
                result.update(parse_pdf(body, work))
            else:
                text = body.decode("utf-8", errors="replace")
                result["htmlTitle"] = html_title(text)
                result["dateCandidates"] = date_candidates(re.sub(r"<[^>]+>", " ", text), source="html_text")
                result["pdfLinkCandidates"] = find_pdf_links(text, response["finalUrl"])
        result["collectionStatus"] = "collected"
    except Exception as error:
        result["collectionStatus"] = "failed"
        result["error"] = f"{type(error).__name__}: {error}"[:1000]
    return result


def main() -> int:
    args = parse_args()
    data = read_bundle()
    targets = repair_targets(data["companies"])
    if args.limit > 0:
        targets = targets[: args.limit]
    if args.dry_run:
        results = [{**target, "collectionStatus": "dry_run", "automaticUpdateAllowed": False} for target in targets]
    else:
        if not shutil.which("pdfinfo") or not shutil.which("pdftotext"):
            raise RuntimeError("poppler-utils is required")
        results = [inspect_target(target) for target in targets]
    report = {
        "version": "source-evidence-candidates-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "dry_run" if args.dry_run else "live",
        "summary": {
            "targets": len(targets),
            "publicationDateTargets": sum("publicationDate" in target["gaps"] for target in targets),
            "pageEvidenceTargets": sum("pageEvidence" in target["gaps"] for target in targets),
            "collected": sum(result.get("collectionStatus") == "collected" for result in results),
            "failed": sum(result.get("collectionStatus") == "failed" for result in results),
        },
        "policy": {
            "candidateOnly": True,
            "automaticUpdateAllowed": False,
            "humanReviewRequired": True,
            "publicationDateMustComeFromOfficialDocument": True,
        },
        "results": results,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"Report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
