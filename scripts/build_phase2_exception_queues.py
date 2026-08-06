#!/usr/bin/env python3
"""Build audited exception queues for Phase 2 source recovery.

The script mirrors only the source-relevance audit classifications. It does not
recover a document, infer facts, complete a review, or approve quality.
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
AUDIT_DIRS = [
    PHASE2 / "source-relevance-v2",
    PHASE2 / "source-relevance-audit",
]
OUTPUT = PHASE2 / "source-repairs" / "exception-recovery-queues-v1.json"

EXPECTED = {
    "source_recovery_required": 52,
    "pdf_identification_required": 14,
    "human_relevance_review_required": 11,
}
CODE_PATTERN = re.compile(r"^(?:\d{4}|\d{3}[A-Z])$")


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


def code_of(record: dict[str, Any]) -> str | None:
    for key in ("code", "companyCode", "securityCode", "ticker"):
        value = record.get(key)
        if value is None:
            continue
        code = str(value).strip()
        if CODE_PATTERN.match(code):
            return code
    company = record.get("company")
    return code_of(company) if isinstance(company, dict) else None


def name_of(record: dict[str, Any]) -> str | None:
    for key in ("name", "companyName", "company_name"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    company = record.get("company")
    return name_of(company) if isinstance(company, dict) else None


def classification_strings(record: dict[str, Any]) -> list[str]:
    keys = (
        "queue",
        "status",
        "classification",
        "category",
        "outcome",
        "reviewQueue",
        "sourceRelevanceStatus",
        "sourceClassification",
    )
    return [
        value.lower()
        for key in keys
        if isinstance((value := record.get(key)), str)
    ]


def classified_as(record: dict[str, Any], classification: str) -> bool:
    values = classification_strings(record)
    if any(classification in value for value in values):
        return True
    serialized = json.dumps(record, ensure_ascii=False).lower()
    compact = classification.replace("_", "")
    return (
        f'"{classification}": true' in serialized
        or f'"{compact}": true' in serialized.replace("_", "")
    )


def template_index() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
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
        result[code] = {
            "company": company,
            "document": value.get("document", {}),
            "reviewInput": str(path.relative_to(ROOT)),
        }
    return result


def collect(classification: str) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for audit_dir in AUDIT_DIRS:
        if not audit_dir.is_dir():
            continue
        for path in sorted(audit_dir.rglob("*.json")):
            try:
                value = load_json(path)
            except (OSError, json.JSONDecodeError):
                continue
            for record in walk(value):
                if not classified_as(record, classification):
                    continue
                code = code_of(record)
                if code is None:
                    continue
                merged = dict(found.get(code, {}))
                merged.update(record)
                merged["auditSourceFile"] = str(path.relative_to(ROOT))
                found[code] = merged
    return found


def source_text(audit: dict[str, Any], document: dict[str, Any]) -> str:
    fields = [
        audit.get("error"),
        audit.get("reason"),
        audit.get("message"),
        audit.get("status"),
        audit.get("classification"),
        document.get("candidateTitle"),
        document.get("sourceUrl"),
        document.get("resolvedPageUrl"),
        document.get("resolvedPdfUrl"),
    ]
    return " ".join(str(value) for value in fields if value is not None).lower()


def recovery_type(text: str) -> str:
    if any(token in text for token in ("403", "401", "access denied", "forbidden", "cloudflare", "robots")):
        return "access_denied_or_bot_protection"
    if any(token in text for token in ("404", "not found", "リンク切れ")):
        return "not_found_or_link_rot"
    if any(token in text for token in ("timeout", "timed out", "時間切れ")):
        return "timeout"
    if any(token in text for token in ("too large", "size limit", "容量", "最大サイズ")):
        return "size_limit"
    if any(token in text for token in ("ssl", "certificate", "dns", "connection", "network")):
        return "network_or_tls"
    if any(token in text for token in ("content-type", "html instead", "not a pdf", "invalid pdf")):
        return "invalid_pdf_or_content_type"
    if any(token in text for token in ("parse", "extract", "xref", "encrypted", "corrupt")):
        return "pdf_parse_failure"
    return "unclassified_recovery_failure"


def pdf_identification_type(text: str) -> str:
    if any(token in text for token in ("javascript", "dynamic", "iframe")):
        return "dynamic_ir_page"
    if any(token in text for token in ("html", "landing page", "web page")):
        return "official_html_without_direct_pdf"
    if any(token in text for token in ("multiple pdf", "複数", "候補")):
        return "multiple_pdf_candidates"
    return "direct_pdf_not_identified"


def relevance_type(text: str) -> str:
    if any(token in text for token in ("統合報告", "integrated report")):
        return "integrated_report_plan_section_boundary"
    if any(token in text for token in ("成長可能性", "growth potential")):
        return "growth_potential_and_formal_plan_boundary"
    if any(token in text for token in ("進捗", "見直し", "revision", "update")):
        return "plan_update_or_revision_boundary"
    if any(token in text for token in ("方針", "policy", "vision")):
        return "management_policy_or_vision_boundary"
    return "ambiguous_document_relevance"


def common_row(
    code: str,
    audit: dict[str, Any],
    template: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    company = template.get("company", {})
    document = template.get("document", {})
    text = source_text(audit, document)
    row = {
        "code": code,
        "name": name_of(audit) or company.get("name") or "名称未特定",
        "auditSourceFile": audit.get("auditSourceFile"),
        "reviewInput": template.get("reviewInput"),
        "observedSource": {
            "title": document.get("candidateTitle") or audit.get("candidateTitle"),
            "publishedDate": document.get("candidatePublishedDate") or audit.get("publishedDate"),
            "sourceUrl": document.get("sourceUrl") or audit.get("sourceUrl"),
            "resolvedPageUrl": document.get("resolvedPageUrl"),
            "resolvedPdfUrl": document.get("resolvedPdfUrl"),
            "pageCount": document.get("pageCount"),
            "pdfSha256": document.get("pdfSha256"),
        },
        "automaticFactCompletionAllowed": False,
        "automaticApprovalAllowed": False,
        "deepVerificationApproved": False,
    }
    return row, text


def main() -> None:
    templates = template_index()
    collected = {key: collect(key) for key in EXPECTED}
    actual = {key: len(value) for key, value in collected.items()}
    if actual != EXPECTED:
        raise SystemExit(f"exception queue count mismatch: expected={EXPECTED}, actual={actual}")

    recovery: list[dict[str, Any]] = []
    recovery_counts: Counter[str] = Counter()
    for code, audit in sorted(collected["source_recovery_required"].items()):
        row, text = common_row(code, audit, templates.get(code, {}))
        category = recovery_type(text)
        recovery_counts[category] += 1
        row.update(
            {
                "recoveryType": category,
                "status": "queued_source_recovery",
                "requiredActions": [
                    "公式IRページと適時開示ページをブラウザで確認する",
                    "アクセス拒否・リンク切れ・容量・解析失敗の原因を記録する",
                    "正式PDFまたは公式HTMLを再取得する",
                    "取得ファイルのURL・ハッシュ・ページ数・取得日時を保存する",
                    "人が資料同一性を確認するまで一次レビューへ進めない",
                ],
            }
        )
        recovery.append(row)

    pdf_identification: list[dict[str, Any]] = []
    pdf_counts: Counter[str] = Counter()
    for code, audit in sorted(collected["pdf_identification_required"].items()):
        row, text = common_row(code, audit, templates.get(code, {}))
        category = pdf_identification_type(text)
        pdf_counts[category] += 1
        row.update(
            {
                "identificationType": category,
                "status": "queued_pdf_identification",
                "requiredActions": [
                    "公式HTMLを一次証跡として保存する",
                    "ページ内リンク・埋め込み・JavaScript・適時開示を確認する",
                    "複数候補がある場合は会社名・計画名・期間・公表日で照合する",
                    "正式PDFが存在しない場合は公式HTMLを資料種別付きで記録する",
                    "人が資料境界を確認するまで一次レビューへ進めない",
                ],
            }
        )
        pdf_identification.append(row)

    relevance: list[dict[str, Any]] = []
    relevance_counts: Counter[str] = Counter()
    for code, audit in sorted(collected["human_relevance_review_required"].items()):
        row, text = common_row(code, audit, templates.get(code, {}))
        category = relevance_type(text)
        relevance_counts[category] += 1
        row.update(
            {
                "relevanceType": category,
                "status": "queued_human_relevance_review",
                "requiredActions": [
                    "資料全体と中期経営計画該当部分の境界を確認する",
                    "正式中計・中計更新・統合報告書掲載・成長可能性資料を分類する",
                    "実績・予想・計画・長期目標・外部市場予測を分離する",
                    "採用する資料区分と除外するページ・項目を記録する",
                    "関連性確認だけでは一次レビュー完了または承認にしない",
                ],
            }
        )
        relevance.append(row)

    output = {
        "schemaVersion": "quality-rebase-phase2-exception-recovery-queues-v1",
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sourceAuditDirectories": [
            str(path.relative_to(ROOT)) for path in AUDIT_DIRS if path.exists()
        ],
        "counts": {
            "sourceRecoveryRequired": len(recovery),
            "pdfIdentificationRequired": len(pdf_identification),
            "humanRelevanceReviewRequired": len(relevance),
            "recovered": 0,
            "primaryReviewComplete": 0,
            "deepVerificationApproved": 0,
        },
        "breakdown": {
            "sourceRecoveryTypes": dict(sorted(recovery_counts.items())),
            "pdfIdentificationTypes": dict(sorted(pdf_counts.items())),
            "humanRelevanceTypes": dict(sorted(relevance_counts.items())),
        },
        "sourceRecoveryQueue": recovery,
        "pdfIdentificationQueue": pdf_identification,
        "humanRelevanceReviewQueue": relevance,
        "approvalSafety": {
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
            "humanSourceIdentityReviewRequired": True,
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
