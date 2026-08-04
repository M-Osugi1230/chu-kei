#!/usr/bin/env python3
"""Resolve and verify one explicitly selected official Phase 2 PDF binary.

The request may select an ``officialPdf`` object so a company with a baseline
plan and one or more progress updates can fix each binary independently. Older
requests remain compatible and fall back to
``sourceResolution.currentOfficialDocument``. The script never completes or
approves any review stage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
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
USER_AGENT = "Chu-kei-Quality-Rebase/1.1 (+official IR verification)"


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


def require_false_flags(value: dict[str, Any], label: str) -> None:
    required = ("automaticApprovalAllowed", "deepVerificationApproved")
    for key in required:
        if value.get(key) is not False:
            raise SystemExit(f"{label} safety flag must be false: {key}")
    if "automaticFactCompletionAllowed" in value:
        if value.get("automaticFactCompletionAllowed") is not False:
            raise SystemExit(
                f"{label} safety flag must be false: automaticFactCompletionAllowed"
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


def resolve_target(
    source: dict[str, Any], request: dict[str, Any]
) -> dict[str, Any]:
    explicit = request.get("officialPdf")
    if explicit is not None:
        if not isinstance(explicit, dict):
            raise SystemExit("request.officialPdf must be an object")
        target = explicit
        selected_by = "request_explicit_official_pdf"
    else:
        current = source.get("currentOfficialDocument")
        if not isinstance(current, dict):
            raise SystemExit(
                "source resolution lacks currentOfficialDocument; "
                "request.officialPdf is required for multi-source resolutions"
            )
        target = current
        selected_by = "source_current_official_document"

    url = str(target.get("url") or target.get("pdfUrl") or "").strip()
    page_count = target.get("pageCount")
    title = str(target.get("title") or "").strip() or None
    source_role = str(target.get("sourceRole") or "").strip() or None
    recorded_hash = target.get("pdfSha256")

    if not url.startswith("https://"):
        raise SystemExit("official PDF URL must use HTTPS")
    if not isinstance(page_count, int) or page_count <= 0:
        raise SystemExit("official PDF pageCount must be a positive integer")
    if recorded_hash is not None and (
        not isinstance(recorded_hash, str) or len(recorded_hash) != 64
    ):
        raise SystemExit("official PDF pdfSha256 must be null or a 64-character string")

    return {
        "url": url,
        "pageCount": page_count,
        "title": title,
        "sourceRole": source_role,
        "recordedHash": recorded_hash,
        "selectedBy": selected_by,
    }


def build_evidence(
    source_path: Path,
    source: dict[str, Any],
    request_path: Path,
    request: dict[str, Any],
) -> dict[str, Any]:
    company = source.get("company")
    if not isinstance(company, dict):
        raise SystemExit("source resolution lacks company")

    request_company = request.get("company")
    if not isinstance(request_company, dict):
        raise SystemExit("request lacks company")

    code = str(company.get("code", "")).strip()
    name = str(company.get("name", "")).strip()
    request_code = str(request_company.get("code", "")).strip()
    if not code or not name or request_code != code:
        raise SystemExit("source/request company identity mismatch")

    require_false_flags(source, "source resolution")
    require_false_flags(request, "request")
    target = resolve_target(source, request)

    data, content_type = download_pdf(target["url"])
    sha256 = hashlib.sha256(data).hexdigest()
    try:
        reader = PdfReader(BytesIO(data), strict=True)
        actual_pages = len(reader.pages)
    except Exception as exc:  # pypdf raises several concrete parser errors
        raise SystemExit(f"downloaded PDF could not be parsed: {exc}") from exc

    expected_pages = target["pageCount"]
    if actual_pages != expected_pages:
        raise SystemExit(
            f"page count mismatch for {code}: expected {expected_pages}, got {actual_pages}"
        )

    recorded_hash = target["recordedHash"]
    if recorded_hash not in (None, sha256):
        raise SystemExit(
            f"recorded hash conflicts with downloaded binary for {code}: "
            f"recorded={recorded_hash}, actual={sha256}"
        )

    return {
        "schemaVersion": "phase2-source-binary-evidence-v2",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "sourceResolutionFile": str(source_path),
        "requestFile": str(request_path),
        "company": {"code": code, "name": name},
        "officialPdf": {
            "title": target["title"],
            "sourceRole": target["sourceRole"],
            "selectedBy": target["selectedBy"],
            "url": target["url"],
            "sha256": sha256,
            "bytes": len(data),
            "pageCount": actual_pages,
            "contentType": content_type,
            "pdfHeaderConfirmed": True,
            "pageCountMatchesRequest": True,
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
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    source_path = Path(args.source_resolution)
    request_path = Path(args.request)
    output_path = Path(args.output)
    source = load_json(source_path)
    request = load_json(request_path)
    evidence = build_evidence(source_path, source, request_path, request)

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
