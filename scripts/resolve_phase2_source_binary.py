#!/usr/bin/env python3
"""Resolve and verify an official Phase 2 PDF binary without inferring facts.

The script reads a source-resolution JSON, downloads only the explicitly recorded
currentOfficialDocument.pdfUrl, verifies that the response is a PDF, calculates
SHA-256 and page count, and writes a separate evidence JSON. It never marks a
primary review, independent review, or deep verification as complete.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

try:
    from pypdf import PdfReader
except ImportError as exc:  # pragma: no cover - enforced by workflow
    raise SystemExit("pypdf is required: pip install pypdf") from exc

MAX_PDF_BYTES = 100 * 1024 * 1024
USER_AGENT = "Chu-kei-Quality-Rebase/1.0 (+official IR verification)"


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"top-level JSON must be an object: {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def download_pdf(url: str) -> tuple[bytes, str | None]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/pdf,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            content_type = response.headers.get_content_type()
            content_length = response.headers.get("Content-Length")
            if content_length is not None and int(content_length) > MAX_PDF_BYTES:
                raise SystemExit(
                    f"PDF exceeds maximum size before download: {content_length} bytes"
                )
            data = response.read(MAX_PDF_BYTES + 1)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        raise SystemExit(f"failed to download official PDF: {exc}") from exc

    if len(data) > MAX_PDF_BYTES:
        raise SystemExit(f"PDF exceeds maximum size: {len(data)} bytes")
    if not data.startswith(b"%PDF-"):
        raise SystemExit(
            f"downloaded content is not a PDF: content-type={content_type!r}, "
            f"prefix={data[:16]!r}"
        )
    return data, content_type


def build_evidence(source_path: Path, source: dict[str, Any]) -> dict[str, Any]:
    company = source.get("company")
    current = source.get("currentOfficialDocument")
    if not isinstance(company, dict) or not isinstance(current, dict):
        raise SystemExit("source resolution lacks company/currentOfficialDocument")

    code = str(company.get("code", "")).strip()
    name = str(company.get("name", "")).strip()
    url = str(current.get("pdfUrl", "")).strip()
    expected_pages = current.get("pageCount")
    if not code or not name or not url:
        raise SystemExit("source resolution lacks company identity or official PDF URL")
    if not url.startswith("https://"):
        raise SystemExit("official PDF URL must use HTTPS")
    if not isinstance(expected_pages, int) or expected_pages <= 0:
        raise SystemExit("currentOfficialDocument.pageCount must be a positive integer")

    for key in (
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        if source.get(key) is not False:
            raise SystemExit(f"source resolution safety flag must be false: {key}")

    data, content_type = download_pdf(url)
    sha256 = hashlib.sha256(data).hexdigest()
    try:
        reader = PdfReader(BytesIO(data), strict=True)
        actual_pages = len(reader.pages)
    except Exception as exc:  # pypdf raises several concrete parser errors
        raise SystemExit(f"downloaded PDF could not be parsed: {exc}") from exc

    if actual_pages != expected_pages:
        raise SystemExit(
            f"page count mismatch for {code}: expected {expected_pages}, got {actual_pages}"
        )

    recorded_hash = current.get("pdfSha256")
    if recorded_hash not in (None, sha256):
        raise SystemExit(
            f"recorded hash conflicts with downloaded binary for {code}: "
            f"recorded={recorded_hash}, actual={sha256}"
        )

    return {
        "schemaVersion": "phase2-source-binary-evidence-v1",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "sourceResolutionFile": str(source_path),
        "company": {"code": code, "name": name},
        "officialPdf": {
            "url": url,
            "sha256": sha256,
            "bytes": len(data),
            "pageCount": actual_pages,
            "contentType": content_type,
            "pdfHeaderConfirmed": True,
            "pageCountMatchesResolution": True,
        },
        "reviewImpact": {
            "primaryReviewComplete": False,
            "independentReviewReady": False,
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-resolution", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    source_path = Path(args.source_resolution)
    output_path = Path(args.output)
    source = load_json(source_path)
    evidence = build_evidence(source_path, source)

    if not args.check:
        if output_path.exists():
            existing = load_json(output_path)
            existing_pdf = existing.get("officialPdf", {})
            new_pdf = evidence["officialPdf"]
            if existing_pdf.get("sha256") != new_pdf["sha256"]:
                raise SystemExit(
                    f"refusing to replace evidence with a different hash: {output_path}"
                )
        write_json(output_path, evidence)

    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
