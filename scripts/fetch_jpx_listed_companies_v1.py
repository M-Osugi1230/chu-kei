#!/usr/bin/env python3
"""Download the latest official TSE listed-company workbook and emit normalized JSON."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable, Sequence

SOURCE_PAGE = "https://www.jpx.co.jp/markets/statistics-equities/misc/01.html"
USER_AGENT = "chu-kei-data-pipeline/1.0 (+https://github.com/M-Osugi1230/chu-kei)"


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def discover_workbook_url(page_url: str, page: bytes) -> str:
    text = page.decode("utf-8", errors="replace")
    links = [
        urllib.parse.urljoin(page_url, html.unescape(match))
        for match in re.findall(r'href=["\']([^"\']+\.(?:xlsx?|XLSX?)(?:\?[^"\']*)?)["\']', text)
    ]
    if not links:
        raise RuntimeError("JPX page did not contain an Excel workbook link")
    preferred = [url for url in links if "data_j" in url.lower()]
    return (preferred or links)[0]


def clean(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip().replace("\u3000", " ")


def read_rows(workbook_url: str, workbook: bytes) -> list[list[object]]:
    lowered = urllib.parse.urlparse(workbook_url).path.lower()
    if lowered.endswith(".xlsx"):
        try:
            import openpyxl  # type: ignore
        except ImportError as exc:
            raise RuntimeError("openpyxl is required to parse the JPX xlsx workbook") from exc
        sheet = openpyxl.load_workbook(io.BytesIO(workbook), read_only=True, data_only=True).active
        return [list(row) for row in sheet.iter_rows(values_only=True)]

    try:
        import xlrd  # type: ignore
    except ImportError as exc:
        raise RuntimeError("xlrd is required to parse the JPX xls workbook") from exc
    book = xlrd.open_workbook(file_contents=workbook)
    sheet = book.sheet_by_index(0)
    return [sheet.row_values(index) for index in range(sheet.nrows)]


def locate_header(rows: Sequence[Sequence[object]]) -> tuple[int, list[str]]:
    for index, row in enumerate(rows[:20]):
        headers = [clean(value) for value in row]
        joined = "|".join(headers)
        if "コード" in headers and "銘柄名" in joined and "市場・商品区分" in joined:
            return index, headers
    raise RuntimeError("Could not locate the JPX workbook header row")


def find_column(headers: Sequence[str], *terms: str) -> int:
    for index, header in enumerate(headers):
        if all(term in header for term in terms):
            return index
    raise RuntimeError(f"Missing JPX workbook column containing: {terms}")


def normalize_code(value: object) -> str:
    code = clean(value).upper()
    if re.fullmatch(r"\d+\.0", code):
        code = code[:-2]
    return code.zfill(4) if code.isdigit() else code


def normalize_records(rows: Sequence[Sequence[object]]) -> list[dict[str, str]]:
    header_index, headers = locate_header(rows)
    code_col = find_column(headers, "コード")
    name_col = find_column(headers, "銘柄名")
    market_col = find_column(headers, "市場・商品区分")
    industry_col = find_column(headers, "33業種区分")

    records: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows[header_index + 1 :]:
        values = list(row)
        if max(code_col, name_col, market_col, industry_col) >= len(values):
            continue
        code = normalize_code(values[code_col])
        name = clean(values[name_col])
        market_product = clean(values[market_col])
        industry = clean(values[industry_col])
        if not re.fullmatch(r"[0-9A-Z]{4}", code) or not name or code in seen:
            continue
        seen.add(code)
        records.append(
            {
                "code": code,
                "name": name,
                "marketProduct": market_product,
                "industry33": industry,
            }
        )
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-page", default=SOURCE_PAGE)
    args = parser.parse_args()

    source_page = str(args.source_page)
    page = fetch_bytes(source_page)
    workbook_url = discover_workbook_url(source_page, page)
    workbook = fetch_bytes(workbook_url)
    rows = read_rows(workbook_url, workbook)
    records = normalize_records(rows)
    if len(records) < 1000:
        raise RuntimeError(f"JPX workbook returned too few listed instruments: {len(records)}")

    output = {
        "version": "jpx-listed-companies-v1",
        "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourcePage": source_page,
        "sourceWorkbook": workbook_url,
        "recordCount": len(records),
        "records": records,
    }
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sourceWorkbook": workbook_url, "recordCount": len(records)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"JPX listed-company fetch failed: {error}", file=sys.stderr)
        raise
