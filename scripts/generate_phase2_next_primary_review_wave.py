#!/usr/bin/env python3
"""Generate the next Phase 2 primary-review assignment wave safely.

This script only assigns already-collected source candidates to a human primary
review queue. It never completes facts, never marks a review complete, and never
approves deep verification.

Selection rules:
- read the canonical source-relevance candidate queue;
- exclude Phase 1 companies, canonical completed reviews, companies with an
  existing canonical primary-review file, and every company already assigned in
  an existing Phase 2 wave;
- require an existing primary-review-template.json in the bulk collection tree;
- accept formal management plans, plan revisions/updates, and management-policy
  or strategy documents by default;
- management-policy or strategy documents always require a human to separate
  formal-plan commitments from directional policy before completion;
- growth-potential documents are excluded unless explicitly enabled, because
  their formal-plan boundary must first be confirmed by a human;
- preserve deterministic ordering by relevance score (descending), then queue
  order (ascending), then security code.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GROWTH_DOCUMENT_TYPE = "growth_potential_document"
MANAGEMENT_POLICY_DOCUMENT_TYPE = "management_policy_or_strategy"
ALLOWED_DEFAULT_DOCUMENT_TYPES = {
    "formal_management_plan",
    "plan_revision_or_update",
    MANAGEMENT_POLICY_DOCUMENT_TYPE,
}
ASSIGNED_STATUS = "primary_review_assigned"
BOUNDARY_REQUIRED_STATUS = "primary_review_assigned_formal_plan_boundary_required"


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


def require_false(value: dict[str, Any], key: str, location: str) -> None:
    if value.get(key) is not False:
        raise SystemExit(f"{location}.{key} must be false")


def canonical_completed_codes(status: dict[str, Any]) -> set[str]:
    records = status.get("completedPrimaryReviews")
    if not isinstance(records, list):
        raise SystemExit("current status completedPrimaryReviews must be an array")
    codes: set[str] = set()
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise SystemExit(f"completedPrimaryReviews[{index}] must be an object")
        code = str(record.get("code", "")).strip()
        if not code:
            raise SystemExit(f"completedPrimaryReviews[{index}] lacks code")
        if code in codes:
            raise SystemExit(f"duplicate completed company code: {code}")
        codes.add(code)
    return codes


def canonical_review_file_codes(phase2_dir: Path) -> set[str]:
    """Return companies that already have a canonical primary-review artifact.

    current-status-v1.json can lag behind append-only review work. The review
    artifact itself is therefore an independent exclusion source. Filename and
    embedded company code must agree so a malformed file cannot silently hide a
    different company from the queue.
    """

    codes: set[str] = set()
    review_paths = [
        *sorted((phase2_dir / "reviews").glob("*-primary-review-v1.json")),
        *sorted(
            (phase2_dir / "primary-reviews").glob(
                "*-wave*-primary-review-v1.json"
            )
        ),
    ]
    for path in review_paths:
        filename_stem = path.name.removesuffix("-primary-review-v1.json").strip()
        filename_code = filename_stem.split("-wave", 1)[0]
        if not filename_code:
            raise SystemExit(f"review filename lacks company code: {path}")

        review = load_json(path)
        company = review.get("company")
        if not isinstance(company, dict):
            raise SystemExit(f"review file lacks company object: {path}")
        embedded_code = str(company.get("code", "")).strip()
        if not embedded_code:
            raise SystemExit(f"review file lacks company code: {path}")
        if embedded_code != filename_code:
            raise SystemExit(
                f"review filename/company code mismatch: {path}: "
                f"{filename_code} != {embedded_code}"
            )
        if embedded_code in codes:
            raise SystemExit(f"duplicate canonical review company code: {embedded_code}")
        codes.add(embedded_code)
    return codes


def existing_wave_state(phase2_dir: Path) -> tuple[set[str], set[int], int]:
    assigned_codes: set[str] = set()
    assigned_orders: set[int] = set()
    highest_wave = 0

    for path in sorted(phase2_dir.glob("primary-review-wave*-v1.json")):
        wave = load_json(path)
        wave_number = wave.get("wave")
        if not isinstance(wave_number, int) or wave_number <= 0:
            raise SystemExit(f"invalid wave number in {path}")
        highest_wave = max(highest_wave, wave_number)

        companies = wave.get("companies")
        if not isinstance(companies, list):
            raise SystemExit(f"companies must be an array: {path}")
        for company in companies:
            if not isinstance(company, dict):
                raise SystemExit(f"invalid company entry: {path}")
            code = str(company.get("code", "")).strip()
            order = company.get("order")
            if not code or not isinstance(order, int):
                raise SystemExit(f"wave entry lacks code or order: {path}")
            if code in assigned_codes:
                raise SystemExit(f"company assigned in multiple waves: {code}")
            if order in assigned_orders:
                raise SystemExit(f"queue order assigned in multiple waves: {order}")
            assigned_codes.add(code)
            assigned_orders.add(order)

    return assigned_codes, assigned_orders, highest_wave


def phase1_codes(repo_root: Path) -> set[str]:
    cohort_path = repo_root / "operations/quality-rebase/phase1-cohort-50-v1.json"
    cohort = load_json(cohort_path)
    companies = cohort.get("companies")
    if not isinstance(companies, list):
        raise SystemExit("Phase 1 cohort companies must be an array")
    result: set[str] = set()
    for company in companies:
        if not isinstance(company, dict):
            raise SystemExit("invalid Phase 1 cohort company")
        code = str(company.get("code", "")).strip()
        if not code:
            raise SystemExit("Phase 1 cohort company lacks code")
        result.add(code)
    return result


def find_review_input(repo_root: Path, code: str) -> Path | None:
    root = repo_root / "operations/quality-rebase/phase2/bulk-collection"
    matches = sorted(root.glob(f"**/{code}/primary-review-template.json"))
    if not matches:
        return None
    if len(matches) > 1:
        exact = [path for path in matches if path.parent.name == code]
        matches = exact or matches
    if len(matches) != 1:
        rendered = ", ".join(str(path.relative_to(repo_root)) for path in matches)
        raise SystemExit(f"ambiguous review input for {code}: {rendered}")
    return matches[0]


def candidate_sort_key(company: dict[str, Any]) -> tuple[int, int, str]:
    score = company.get("relevanceScore")
    order = company.get("order")
    code = str(company.get("code", ""))
    if not isinstance(score, int) or not isinstance(order, int) or not code:
        raise SystemExit(f"candidate lacks valid score/order/code: {company}")
    return (-score, order, code)


def build_wave(
    repo_root: Path,
    target_count: int,
    include_growth_documents: bool,
) -> dict[str, Any]:
    phase2_dir = repo_root / "operations/quality-rebase/phase2"
    queue_path = phase2_dir / "source-relevance-audit/primary-review-candidates.json"
    status_path = phase2_dir / "current-status-v1.json"

    queue = load_json(queue_path)
    status = load_json(status_path)
    require_false(queue, "automaticApprovalAllowed", "candidateQueue")
    require_false(status, "automaticDeepApprovalAllowed", "currentStatus")

    candidates = queue.get("companies")
    if not isinstance(candidates, list):
        raise SystemExit("candidate queue companies must be an array")

    completed_from_status = canonical_completed_codes(status)
    completed_from_review_files = canonical_review_file_codes(phase2_dir)
    completed = completed_from_status | completed_from_review_files
    assigned, assigned_orders, highest_wave = existing_wave_state(phase2_dir)
    phase1 = phase1_codes(repo_root)

    excluded_codes = completed | assigned | phase1
    selected: list[dict[str, Any]] = []
    skipped_missing_input: list[str] = []

    for candidate in sorted(candidates, key=candidate_sort_key):
        if not isinstance(candidate, dict):
            raise SystemExit("candidate entry must be an object")

        code = str(candidate.get("code", "")).strip()
        order = candidate.get("order")
        document_type = candidate.get("documentTypeCandidate")
        if not code or not isinstance(order, int):
            raise SystemExit("candidate lacks code or order")
        if code in excluded_codes or order in assigned_orders:
            continue
        if candidate.get("relevanceClassification") != "primary_review_candidate":
            continue
        if candidate.get("blockers") not in ([], None):
            continue
        if candidate.get("automaticApprovalAllowed") is not False:
            raise SystemExit(f"candidate {code} does not prohibit automatic approval")
        if candidate.get("deepVerificationApproved") is not False:
            raise SystemExit(f"candidate {code} is unexpectedly approved")

        if document_type not in ALLOWED_DEFAULT_DOCUMENT_TYPES:
            if not (include_growth_documents and document_type == GROWTH_DOCUMENT_TYPE):
                continue

        review_input = find_review_input(repo_root, code)
        if review_input is None:
            skipped_missing_input.append(code)
            continue

        boundary_required = document_type in {
            "plan_revision_or_update",
            MANAGEMENT_POLICY_DOCUMENT_TYPE,
            GROWTH_DOCUMENT_TYPE,
        }
        required_checks = [
            "formalPlanBoundary",
            "fullTextReview",
            "metricsValidation",
            "capitalPolicyReview",
            "fieldLevelEvidence",
        ]
        if document_type == "plan_revision_or_update":
            required_checks.insert(1, "planRevisionSeparation")
        if document_type == MANAGEMENT_POLICY_DOCUMENT_TYPE:
            required_checks.insert(1, "formalPlanOrPolicySeparation")
        if document_type == GROWTH_DOCUMENT_TYPE:
            required_checks.insert(1, "formalPlanExistenceWithinGrowthDocument")

        selected.append(
            {
                "order": order,
                "code": code,
                "name": candidate.get("name"),
                "documentTypeCandidate": document_type,
                "relevanceScore": candidate.get("relevanceScore"),
                "pageCount": candidate.get("signals", {}).get("pageCount"),
                "reviewInput": str(review_input.relative_to(repo_root)),
                "status": (
                    BOUNDARY_REQUIRED_STATUS if boundary_required else ASSIGNED_STATUS
                ),
                "requiredChecks": required_checks,
            }
        )
        excluded_codes.add(code)
        assigned_orders.add(order)
        if len(selected) == target_count:
            break

    if len(selected) != target_count:
        raise SystemExit(
            f"could select only {len(selected)} of {target_count} companies; "
            f"missing review inputs: {', '.join(skipped_missing_input[:20]) or 'none'}"
        )

    selected_codes = {item["code"] for item in selected}
    stale_review_overlap = selected_codes & completed_from_review_files
    if stale_review_overlap:
        raise SystemExit(
            "generated wave contains companies with canonical review files: "
            + ", ".join(sorted(stale_review_overlap))
        )

    next_wave = highest_wave + 1
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    type_counts = {
        "formalManagementPlanCandidates": sum(
            item["documentTypeCandidate"] == "formal_management_plan"
            for item in selected
        ),
        "planRevisionOrUpdateCandidates": sum(
            item["documentTypeCandidate"] == "plan_revision_or_update"
            for item in selected
        ),
        "growthPotentialDocumentCandidates": sum(
            item["documentTypeCandidate"] == GROWTH_DOCUMENT_TYPE
            for item in selected
        ),
        "managementPolicyOrStrategyCandidates": sum(
            item["documentTypeCandidate"] == MANAGEMENT_POLICY_DOCUMENT_TYPE
            for item in selected
        ),
    }

    return {
        "schemaVersion": "phase2-primary-review-wave-v1",
        "generatedAt": now,
        "updatedAt": now,
        "wave": next_wave,
        "targetCompanies": target_count,
        "sourceRelevanceAudit": str(queue_path.relative_to(repo_root)),
        "selectionPolicy": {
            "sourceQueue": "primary_review_candidate",
            "excludeCompletedPrimaryReviews": True,
            "excludeCanonicalPrimaryReviewFiles": True,
            "excludePhase1ReviewedCompanies": True,
            "excludePreviouslyAssignedCompanies": True,
            "requireExistingReviewInput": True,
            "preferCurrentFormalManagementPlan": True,
            "preferCurrentPlanRevisionOrUpdate": True,
            "allowManagementPolicyOrStrategyWithBoundaryReview": True,
            "excludeKnownWrongDocumentAndRecoveryQueues": True,
            "growthPotentialDocumentsEnabled": include_growth_documents,
            "automaticFactCompletionAllowed": False,
            "automaticApprovalAllowed": False,
            "deepVerificationApproved": False,
        },
        "companies": selected,
        "counts": {
            "assigned": target_count,
            **type_counts,
            "primaryReviewComplete": 0,
            "independentReviewReady": 0,
            "deepVerificationApproved": 0,
        },
        "completionRule": (
            "一次レビュー完了は、資料区分、全文確認、主要数値の年度・単位・範囲、"
            "資本政策、項目別証跡を人が確認した場合のみ記録する。"
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--target-count", type=int, default=10)
    parser.add_argument("--output", default=None)
    parser.add_argument(
        "--include-growth-documents",
        action="store_true",
        help="Allow growth-potential documents; formal-plan boundary remains mandatory.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Generate and validate in memory without writing the output file.",
    )
    args = parser.parse_args()

    if args.target_count <= 0:
        raise SystemExit("target-count must be positive")

    repo_root = Path(args.repo_root).resolve()
    wave = build_wave(
        repo_root=repo_root,
        target_count=args.target_count,
        include_growth_documents=args.include_growth_documents,
    )

    output_value = args.output or (
        "operations/quality-rebase/phase2/"
        f"primary-review-wave{wave['wave']:02d}-v1.json"
    )
    output_path = repo_root / output_value
    if output_path.exists():
        raise SystemExit(f"refusing to overwrite existing wave: {output_path}")

    if not args.check:
        write_json(output_path, wave)

    print(
        json.dumps(
            {
                "status": "ok",
                "mode": "check" if args.check else "write",
                "wave": wave["wave"],
                "assigned": wave["counts"]["assigned"],
                "output": str(output_path.relative_to(repo_root)),
                "automaticApprovalAllowed": False,
                "deepVerificationApproved": 0,
                "companies": [
                    {"code": item["code"], "name": item["name"]}
                    for item in wave["companies"]
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
