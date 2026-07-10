from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report_path = Path(args.report)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    checks = []
    issues = []

    def check(name: str, ok: bool, detail: str = ""):
        checks.append({"name": name, "ok": ok, "detail": detail})
        if not ok:
            issues.append({"name": name, "detail": detail})

    results = report.get("results", [])
    summary = report.get("summary", {})
    policy = report.get("policy", {})
    check("version", report.get("version") == "source-evidence-candidates-v1")
    check("mode", report.get("mode") in {"dry_run", "live"})
    check("candidate only", policy.get("candidateOnly") is True)
    check("automatic updates forbidden", policy.get("automaticUpdateAllowed") is False)
    check("human review required", policy.get("humanReviewRequired") is True)
    check("official document date required", policy.get("publicationDateMustComeFromOfficialDocument") is True)
    check("target count matches", summary.get("targets") == len(results), f"summary={summary.get('targets')} actual={len(results)}")
    check("publication target count", summary.get("publicationDateTargets") == sum("publicationDate" in item.get("gaps", []) for item in results))
    check("page target count", summary.get("pageEvidenceTargets") == sum("pageEvidence" in item.get("gaps", []) for item in results))
    check("company codes valid", all(isinstance(item.get("code"), str) and len(item["code"]) == 4 for item in results))
    check("source URLs HTTPS", all(str(item.get("sourceUrl", "")).startswith("https://") for item in results))
    check("gaps are limited", all(set(item.get("gaps", [])).issubset({"publicationDate", "pageEvidence"}) and item.get("gaps") for item in results))
    check("automatic update false per result", all(item.get("automaticUpdateAllowed") is False for item in results))
    check("collection status valid", all(item.get("collectionStatus") in {"dry_run", "collected", "failed"} for item in results))
    check("no automatic corrected records", not any(item.get("status") == "corrected" for item in results))

    output = ROOT / "artifacts" / "source-evidence-candidates-validation-v1.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    validation = {
        "version": "source-evidence-candidates-validation-v1",
        "report": str(report_path),
        "passed": sum(item["ok"] for item in checks),
        "total": len(checks),
        "allPassed": not issues,
        "checks": checks,
        "issues": issues,
    }
    output.write_text(json.dumps(validation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for item in checks:
        print(f"{'PASS' if item['ok'] else 'FAIL'} {item['name']}{': ' + item['detail'] if item['detail'] else ''}")
    print(f"{validation['passed']}/{validation['total']} checks passed")
    return 0 if not issues else 1


if __name__ == "__main__":
    raise SystemExit(main())
