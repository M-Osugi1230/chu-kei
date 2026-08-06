from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REVIEW_DIR = ROOT / "artifacts" / "quality-rebase" / "phase1-review-packets"
DEFAULT_REPORT = ROOT / "artifacts" / "quality-rebase" / "phase1-human-review-validation-v1.json"
COHORT_PATH = ROOT / "operations" / "quality-rebase" / "phase1-cohort-50-v1.json"

REQUIRED_CHECKS = [
    "formalPlanConfirmed",
    "fullTextReviewed",
    "strategyStructured",
    "metricsValidated",
    "evidenceLinked",
    "independentDoubleCheck",
]

REQUIRED_STRUCTURED_FIELDS = [
    "planPeriod",
    "vision",
    "strategies",
    "financialTargets",
    "capitalAllocation",
    "shareholderReturn",
    "businessPortfolio",
    "risksAndAssumptions",
]

PAGE_PATTERN = re.compile(r"^(?:p\.?\s*)?([1-9]\d*)$", re.I)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-dir", default=str(DEFAULT_REVIEW_DIR))
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument("--require-all-50", action="store_true")
    return parser.parse_args()


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def nonempty(value: Any) -> bool:
    if isinstance(value, list):
        return len(value) > 0
    if isinstance(value, dict):
        return len(value) > 0
    return bool(text(value))


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_reviewers(reviewers: Any) -> list[str]:
    if not isinstance(reviewers, list):
        return []
    return [text(value) for value in reviewers if text(value)]


def valid_evidence_item(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    field = text(item.get("field"))
    page = text(item.get("page"))
    quote_or_summary = text(item.get("quote")) or text(item.get("summary"))
    source_sha = text(item.get("sourcePdfSha256"))
    return (
        bool(field)
        and bool(PAGE_PATTERN.match(page))
        and len(quote_or_summary) >= 10
        and bool(re.fullmatch(r"[0-9a-f]{64}", source_sha))
    )


def valid_metric_item(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    required = ["metric", "value", "unit", "fiscalYear", "scope", "page", "sourcePdfSha256"]
    if not all(nonempty(item.get(key)) for key in required):
        return False
    if not PAGE_PATTERN.match(text(item.get("page"))):
        return False
    if not re.fullmatch(r"[0-9a-f]{64}", text(item.get("sourcePdfSha256"))):
        return False
    scope = text(item.get("scope"))
    if scope not in {"consolidated", "non_consolidated", "segment", "other"}:
        return False
    if item.get("validated") is not True:
        return False
    return True


def validate_review(path: Path, expected_company: dict[str, Any] | None) -> dict[str, Any]:
    issues: list[str] = []
    review = load_json(path)
    company = review.get("company") if isinstance(review.get("company"), dict) else {}
    code = text(company.get("code"))
    status = text(review.get("status"))
    approval = review.get("approval") if isinstance(review.get("approval"), dict) else {}
    approved = approval.get("approved") is True

    if review.get("schemaVersion") != "quality-rebase-phase1-human-review-v1":
        issues.append("unsupported_schema")
    if not code:
        issues.append("missing_company_code")
    if expected_company and code != text(expected_company.get("code")):
        issues.append("company_code_mismatch")
    if approval.get("automaticApprovalAllowed") is not False:
        issues.append("automatic_approval_must_be_false")

    reviewers = normalize_reviewers(review.get("reviewers"))
    if len(reviewers) != len(set(reviewers)):
        issues.append("reviewers_must_be_distinct")

    checks = review.get("checks") if isinstance(review.get("checks"), dict) else {}
    missing_check_keys = [key for key in REQUIRED_CHECKS if key not in checks]
    if missing_check_keys:
        issues.append(f"missing_check_keys:{','.join(missing_check_keys)}")

    structured = review.get("structuredFields") if isinstance(review.get("structuredFields"), dict) else {}
    evidence = review.get("fieldEvidence") if isinstance(review.get("fieldEvidence"), list) else []
    metrics = review.get("metricValidation") if isinstance(review.get("metricValidation"), list) else []

    if approved:
        if status != "approved":
            issues.append("approved_record_requires_approved_status")
        if len(set(reviewers)) < 2:
            issues.append("approved_record_requires_two_distinct_reviewers")
        for key in REQUIRED_CHECKS:
            if checks.get(key) is not True:
                issues.append(f"approved_record_check_not_true:{key}")
        for key in REQUIRED_STRUCTURED_FIELDS:
            if not nonempty(structured.get(key)):
                issues.append(f"approved_record_missing_structured_field:{key}")
        if not evidence:
            issues.append("approved_record_requires_field_evidence")
        if any(not valid_evidence_item(item) for item in evidence):
            issues.append("approved_record_has_invalid_field_evidence")
        evidence_fields = {text(item.get("field")) for item in evidence if isinstance(item, dict)}
        required_evidence_fields = {
            "planPeriod",
            "vision",
            "strategies",
            "financialTargets",
            "capitalAllocation",
            "shareholderReturn",
        }
        missing_evidence = sorted(required_evidence_fields - evidence_fields)
        if missing_evidence:
            issues.append(f"approved_record_missing_evidence_fields:{','.join(missing_evidence)}")
        if structured.get("financialTargets") and not metrics:
            issues.append("approved_record_requires_metric_validation")
        if any(not valid_metric_item(item) for item in metrics):
            issues.append("approved_record_has_invalid_metric_validation")
        if not text(approval.get("approvedAt")):
            issues.append("approved_record_requires_approved_at")
    else:
        if status == "approved":
            issues.append("status_approved_without_approval")

    return {
        "file": str(path),
        "code": code,
        "status": status,
        "approved": approved,
        "reviewerCount": len(set(reviewers)),
        "evidenceCount": len(evidence),
        "metricValidationCount": len(metrics),
        "valid": not issues,
        "issues": issues,
    }


def main() -> int:
    args = parse_args()
    review_dir = Path(args.review_dir)
    report_path = Path(args.report)
    cohort = load_json(COHORT_PATH)
    expected = {text(company["code"]): company for company in cohort["companies"]}
    review_files = sorted(review_dir.glob("*-review.json"))

    results = []
    seen_codes: set[str] = set()
    for path in review_files:
        raw = load_json(path)
        code = text((raw.get("company") or {}).get("code"))
        result = validate_review(path, expected.get(code))
        results.append(result)
        if code in seen_codes:
            result["valid"] = False
            result["issues"].append("duplicate_company_review")
        seen_codes.add(code)

    missing_codes = sorted(set(expected) - seen_codes)
    unknown_codes = sorted(seen_codes - set(expected))
    issues = [result for result in results if not result["valid"]]
    if unknown_codes:
        issues.append({"file": None, "code": None, "valid": False, "issues": [f"unknown_codes:{','.join(unknown_codes)}"]})
    if args.require_all_50 and missing_codes:
        issues.append({"file": None, "code": None, "valid": False, "issues": [f"missing_codes:{','.join(missing_codes)}"]})

    report = {
        "schemaVersion": "quality-rebase-phase1-human-review-validation-v1",
        "reviewDirectory": str(review_dir),
        "cohortCompanies": len(expected),
        "reviewFiles": len(review_files),
        "approved": sum(result["approved"] for result in results),
        "valid": sum(result["valid"] for result in results),
        "invalid": sum(not result["valid"] for result in results),
        "missingCodes": missing_codes,
        "unknownCodes": unknown_codes,
        "allPassed": not issues,
        "automaticDeepApprovalAllowed": False,
        "results": results,
        "issues": issues,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "reviewFiles": report["reviewFiles"],
        "approved": report["approved"],
        "valid": report["valid"],
        "invalid": report["invalid"],
        "missing": len(report["missingCodes"]),
        "allPassed": report["allPassed"],
    }, ensure_ascii=False, indent=2))
    return 0 if report["allPassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
