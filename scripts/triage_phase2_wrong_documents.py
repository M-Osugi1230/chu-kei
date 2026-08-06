#!/usr/bin/env python3
"""Build a deterministic repair queue for Phase 2 likely-wrong documents.

Only companies already classified as ``likely_wrong_document`` by the source
relevance audit are included. The script does not recover a replacement source,
complete facts, or approve quality. It classifies the observed negative signals
and prepares an official-IR recovery checklist.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
PHASE2 = ROOT / "operations" / "quality-rebase" / "phase2"
AUDIT_DIR = PHASE2 / "source-relevance-v2"
OUTPUT = PHASE2 / "source-repairs" / "likely-wrong-document-queue-v1.json"
EXPECTED_COUNT = 60

CODE_PATTERN = re.compile(r"^(?:\d{4}|\d{3}[A-Z])$")
YEAR_PATTERN = re.compile(r"(?:19|20)\d{2}")

SIGNAL_PATTERNS: dict[str, tuple[str, ...]] = {
    "non_plan_corporate_notice": (
        "休日",
        "休業",
        "人事",
        "組織変更",
        "役員",
        "訃報",
        "定款",
        "株主総会",
        "招集通知",
        "議決権",
    ),
    "earnings_or_forecast_document": (
        "決算短信",
        "決算説明",
        "業績予想",
        "通期業績",
        "四半期",
        "月次",
        "売上速報",
    ),
    "capital_action_only": (
        "自己株式",
        "配当予想",
        "剰余金の配当",
        "新株予約権",
        "株式分割",
        "株主優待",
    ),
    "transaction_or_governance_document": (
        "株式譲渡",
        "子会社化",
        "吸収合併",
        "会社分割",
        "公開買付",
        "支配株主",
        "コーポレート・ガバナンス",
    ),
    "sustainability_only_document": (
        "サステナビリティレポート",
        "環境報告",
        "TCFD",
        "人権方針",
    ),
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def walk(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def normalized_code(record: dict[str, Any]) -> str | None:
    for key in ("code", "companyCode", "securityCode", "ticker"):
        value = record.get(key)
        if value is None:
            continue
        code = str(value).strip()
        if CODE_PATTERN.match(code):
            return code
    company = record.get("company")
    if isinstance(company, dict):
        return normalized_code(company)
    return None


def record_is_wrong_document(record: dict[str, Any]) -> bool:
    relevant_keys = (
        "queue",
        "status",
        "classification",
        "category",
        "outcome",
        "reviewQueue",
        "sourceRelevanceStatus",
        "sourceClassification",
    )
    values: list[str] = []
    for key in relevant_keys:
        value = record.get(key)
        if isinstance(value, str):
            values.append(value)
    if any("likely_wrong_document" in value.lower() for value in values):
        return True

    serialized = json.dumps(record, ensure_ascii=False).lower()
    return '"likelywrongdocument": true' in serialized or '"likely_wrong_document": true' in serialized


def extract_name(record: dict[str, Any]) -> str | None:
    for key in ("name", "companyName", "company_name"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    company = record.get("company")
    if isinstance(company, dict):
        return extract_name(company)
    return None


def template_index() -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for path in PHASE2.glob("bulk-collection/**/primary-review-template.json"):
        try:
            value = load_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(value, dict):
            continue
        company = value.get("company", {})
        code = str(company.get("code", "")).strip()
        if not CODE_PATTERN.match(code):
            continue
        document = value.get("document", {})
        index[code] = {
            "company": company,
            "document": document,
            "reviewInput": str(path.relative_to(ROOT)),
        }
    return index


def detect_signals(title: str, published_date: str | None, url: str) -> list[str]:
    haystack = f"{title} {url}".lower()
    signals: list[str] = []
    for signal, patterns in SIGNAL_PATTERNS.items():
        if any(pattern.lower() in haystack for pattern in patterns):
            signals.append(signal)

    years = [int(value) for value in YEAR_PATTERN.findall(f"{title} {published_date or ''}")]
    if years and max(years) <= 2021:
        signals.append("potentially_obsolete_source")
    if not url.lower().endswith(".pdf"):
        signals.append("pdf_not_directly_resolved")
    if not signals:
        signals.append("semantic_mismatch_requires_human_review")
    return signals


def collect_audited_records() -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for path in sorted(AUDIT_DIR.rglob("*.json")):
        try:
            value = load_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        for record in walk(value):
            if not record_is_wrong_document(record):
                continue
            code = normalized_code(record)
            if code is None:
                continue
            existing = found.get(code, {})
            merged = dict(existing)
            merged.update(record)
            merged["auditSourceFile"] = str(path.relative_to(ROOT))
            found[code] = merged
    return found


def main() -> None:
    audited = collect_audited_records()
    templates = template_index()

    if len(audited) != EXPECTED_COUNT:
        raise SystemExit(
            f"likely_wrong_document count mismatch: expected={EXPECTED_COUNT}, actual={len(audited)}"
        )

    companies: list[dict[str, Any]] = []
    signal_counts: Counter[str] = Counter()
    for code in sorted(audited):
        audit = audited[code]
        template = templates.get(code, {})
        company = template.get("company", {})
        document = template.get("document", {})

        name = (
            extract_name(audit)
            or (company.get("name") if isinstance(company, dict) else None)
            or "名称未特定"
        )
        title = str(
            document.get("candidateTitle")
            or audit.get("candidateTitle")
            or audit.get("title")
            or ""
        )
        published_date_value = document.get("candidatePublishedDate") or audit.get("publishedDate")
        published_date = str(published_date_value) if published_date_value else None
        url = str(
            document.get("resolvedPdfUrl")
            or document.get("sourceUrl")
            or audit.get("sourceUrl")
            or audit.get("url")
            or ""
        )
        signals = detect_signals(title, published_date, url)
        signal_counts.update(signals)

        companies.append(
            {
                "code": code,
                "name": name,
                "auditSourceFile": audit.get("auditSourceFile"),
                "reviewInput": template.get("reviewInput"),
                "observedSource": {
                    "title": title or None,
                    "publishedDate": published_date,
                    "url": url or None,
                    "pageCount": document.get("pageCount"),
                    "pdfSha256": document.get("pdfSha256"),
                },
                "negativeSignals": signals,
                "status": "queued_official_ir_source_recovery",
                "requiredResolution": [
                    "会社公式IR・経営方針・中期経営計画ページを確認する",
                    "会社名・証券コード・計画名称・公表日・計画期間を確認する",
                    "正式PDFまたは公式HTMLを特定してURL・ハッシュ・ページ数を保存する",
                    "誤資料を一次レビュー・公開データ・検索結果の証跡に使用しない",
                    "代替資料を人が確認するまで一次レビュー完了へ昇格しない",
                ],
                "automaticFactCompletionAllowed": False,
                "automaticApprovalAllowed": False,
                "deepVerificationApproved": False,
            }
        )

    output = {
        "schemaVersion": "quality-rebase-phase2-wrong-document-repair-queue-v1",
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sourceAuditDirectory": str(AUDIT_DIR.relative_to(ROOT)),
        "counts": {
            "companies": len(companies),
            "negativeSignals": dict(sorted(signal_counts.items())),
            "recovered": 0,
            "primaryReviewComplete": 0,
            "deepVerificationApproved": 0,
        },
        "companies": companies,
        "approvalSafety": {
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
            "replacementSourceHumanReviewRequired": True,
        },
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(output["counts"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
