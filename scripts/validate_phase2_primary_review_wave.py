#!/usr/bin/env python3
"""Validate an in-progress Phase 2 primary-review wave safely.

The wave begins as an assignment queue and is updated only when a human primary
review is actually completed. Completion is accepted only when the referenced
review record exists, substantive validation flags are present, and an
independent-review packet is still pending for a distinct reviewer.

This validator never grants approval and never infers missing facts.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable

REQUIRED_COMPANY_FIELDS = {
    "order",
    "code",
    "name",
    "documentTypeCandidate",
    "relevanceScore",
    "pageCount",
    "reviewInput",
    "status",
    "requiredChecks",
}

FORBIDDEN_TRUE_KEYS = {
    "automaticFactCompletionAllowed",
    "automaticApprovalAllowed",
    "deepVerificationApproved",
}

ALREADY_COMPLETED_CODES = {"4061", "8113"}
ALLOWED_DOCUMENT_TYPES = {
    "formal_management_plan",
    "plan_revision_or_update",
    "growth_potential_document",
}
ASSIGNED_STATUSES = {
    "primary_review_assigned",
    "primary_review_assigned_formal_plan_boundary_required",
}
COMPLETED_STATUS = "primary_review_complete_independent_review_ready"

SUBSTANTIVE_COMPLETION_SIGNALS = {
    "full_text": (
        ("validation", "fullTextHumanReviewComplete"),
        ("document", "fullTextHumanReviewComplete"),
        ("source", "fullTextHumanReviewComplete"),
    ),
    "metrics": (
        ("validation", "metricsValidated"),
        ("validation", "metricsValidatedPrimaryPass"),
    ),
    "field_evidence": (
        ("validation", "fieldLevelEvidenceLinked"),
    ),
}


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"top-level value must be an object: {path}")
    return value


def assert_no_forbidden_true(value: Any, location: str = "root") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            child_location = f"{location}.{key}"
            if key in FORBIDDEN_TRUE_KEYS and child is True:
                raise SystemExit(
                    f"forbidden automatic approval/completion flag at {child_location}"
                )
            if key == "status" and isinstance(child, str) and "approved" in child:
                raise SystemExit(f"approved status is not allowed at {child_location}")
            assert_no_forbidden_true(child, child_location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_true(child, f"{location}[{index}]")


def get_path(value: dict[str, Any], path: Iterable[str]) -> Any:
    current: Any = value
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def has_any_true(value: dict[str, Any], paths: Iterable[tuple[str, ...]]) -> bool:
    return any(get_path(value, path) is True for path in paths)


def validate_primary_review_record(
    company: dict[str, Any],
    repo_root: Path,
) -> None:
    code = str(company["code"])
    review_file_value = company.get("reviewFile")
    if not isinstance(review_file_value, str) or not review_file_value:
        raise SystemExit(f"completed company missing reviewFile: {code}")

    review_path = repo_root / review_file_value
    review_record = load_json(review_path)

    review_company = review_record.get("company")
    if not isinstance(review_company, dict) or str(review_company.get("code")) != code:
        raise SystemExit(f"reviewFile company code mismatch for {code}: {review_path}")

    review_state = review_record.get("review")
    if not isinstance(review_state, dict):
        raise SystemExit(f"review section missing for completed company {code}")
    review_status = str(review_state.get("status", ""))
    if not review_status.startswith("primary_review_complete"):
        raise SystemExit(
            f"review record is not primary-review complete for {code}: {review_status}"
        )

    completed_checks = company.get("completedChecks")
    if not isinstance(completed_checks, list) or not completed_checks:
        raise SystemExit(f"completedChecks missing for completed company {code}")
    for required_check in ("fullTextReview", "metricsValidation", "fieldLevelEvidence"):
        if required_check not in completed_checks:
            raise SystemExit(
                f"completed company {code} lacks completed check {required_check}"
            )

    for signal_name, signal_paths in SUBSTANTIVE_COMPLETION_SIGNALS.items():
        if not has_any_true(review_record, signal_paths):
            raise SystemExit(
                f"review record lacks substantive completion signal "
                f"{signal_name} for {code}"
            )

    assert_no_forbidden_true(review_record, f"review[{code}]")


def validate_current_packet_schema(packet: dict[str, Any], code: str) -> None:
    checks = packet.get("checks")
    if not isinstance(checks, list) or not checks:
        raise SystemExit(f"independent packet has no checks for {code}")
    if any(
        not isinstance(check, dict) or check.get("status") != "pending"
        for check in checks
    ):
        raise SystemExit(
            "independent packet checks must remain pending before a distinct "
            f"reviewer acts: {code}"
        )

    review = packet.get("review")
    if not isinstance(review, dict):
        raise SystemExit(f"independent packet review section missing for {code}")
    if review.get("minimumDistinctReviewers", 0) < 2:
        raise SystemExit(f"independent packet reviewer minimum is invalid for {code}")
    if review.get("primaryReviewerMustNotSelfApprove") is not True:
        raise SystemExit(f"self-approval prohibition missing for {code}")
    if review.get("completedAt") is not None or review.get("reviewer") is not None:
        raise SystemExit(f"independent packet was prematurely completed for {code}")


def validate_legacy_packet_schema(packet: dict[str, Any], code: str) -> None:
    checks = packet.get("requiredChecks")
    if not isinstance(checks, list) or not checks:
        raise SystemExit(f"legacy independent packet has no requiredChecks for {code}")
    if any(
        not isinstance(check, dict) or check.get("completed") is not False
        for check in checks
    ):
        raise SystemExit(
            "legacy independent packet checks must remain incomplete before a "
            f"distinct reviewer acts: {code}"
        )

    independence = packet.get("independenceRequirement")
    if not isinstance(independence, dict):
        raise SystemExit(
            f"legacy independent packet lacks independenceRequirement for {code}"
        )
    if independence.get("minimumDistinctReviewers", 0) < 2:
        raise SystemExit(f"legacy packet reviewer minimum is invalid for {code}")
    if independence.get("reviewerMustDifferFromPrimaryReviewer") is not True:
        raise SystemExit(f"legacy packet lacks distinct-reviewer rule for {code}")
    if independence.get("reviewerRecorded") is not False:
        raise SystemExit(f"legacy packet was prematurely assigned/completed for {code}")


def validate_independent_packet_content(
    packet: dict[str, Any],
    code: str,
    packet_path: Path,
) -> None:
    packet_company = packet.get("company")
    if not isinstance(packet_company, dict) or str(packet_company.get("code")) != code:
        raise SystemExit(
            f"independent packet company code mismatch for {code}: {packet_path}"
        )
    if packet.get("status") != "independent_review_ready":
        raise SystemExit(
            f"independent packet is not ready for {code}: {packet.get('status')}"
        )

    if "checks" in packet:
        validate_current_packet_schema(packet, code)
    elif "requiredChecks" in packet:
        validate_legacy_packet_schema(packet, code)
    else:
        raise SystemExit(
            f"independent packet has no supported pending-check schema for {code}"
        )

    assert_no_forbidden_true(packet, f"independent[{code}]")


def validate_independent_review_packet(
    company: dict[str, Any],
    repo_root: Path,
) -> None:
    code = str(company["code"])
    packet_file_value = company.get("independentReviewFile")
    if not isinstance(packet_file_value, str) or not packet_file_value:
        raise SystemExit(f"independent-ready company missing packet: {code}")

    packet_path = repo_root / packet_file_value
    packet = load_json(packet_path)
    validate_independent_packet_content(packet, code, packet_path)


def validate_wave(wave: dict[str, Any], repo_root: Path) -> dict[str, int]:
    if wave.get("schemaVersion") != "phase2-primary-review-wave-v1":
        raise SystemExit("unexpected schemaVersion")

    companies = wave.get("companies")
    if not isinstance(companies, list):
        raise SystemExit("companies must be an array")

    target = wave.get("targetCompanies")
    if not isinstance(target, int) or target <= 0:
        raise SystemExit("targetCompanies must be a positive integer")
    if len(companies) != target:
        raise SystemExit(
            f"company count mismatch: targetCompanies={target}, actual={len(companies)}"
        )

    codes: list[str] = []
    orders: list[int] = []
    completed_count = 0
    independent_ready_count = 0

    for index, company in enumerate(companies):
        if not isinstance(company, dict):
            raise SystemExit(f"companies[{index}] must be an object")

        missing = REQUIRED_COMPANY_FIELDS - company.keys()
        if missing:
            raise SystemExit(
                f"companies[{index}] missing fields: {', '.join(sorted(missing))}"
            )

        code = str(company["code"])
        codes.append(code)
        if code in ALREADY_COMPLETED_CODES:
            raise SystemExit(f"already completed company was reassigned: {code}")

        order = company["order"]
        if not isinstance(order, int) or order < 51:
            raise SystemExit(f"invalid Phase 2 order for {code}: {order}")
        orders.append(order)

        document_type = company["documentTypeCandidate"]
        if document_type not in ALLOWED_DOCUMENT_TYPES:
            raise SystemExit(
                f"unsupported documentTypeCandidate for {code}: {document_type}"
            )

        score = company["relevanceScore"]
        if not isinstance(score, int) or score <= 0:
            raise SystemExit(f"invalid relevanceScore for {code}: {score}")

        page_count = company["pageCount"]
        if not isinstance(page_count, int) or page_count <= 0:
            raise SystemExit(f"invalid pageCount for {code}: {page_count}")

        required_checks = company["requiredChecks"]
        if not isinstance(required_checks, list) or len(required_checks) < 4:
            raise SystemExit(f"insufficient requiredChecks for {code}")
        if "fieldLevelEvidence" not in required_checks:
            raise SystemExit(f"fieldLevelEvidence check missing for {code}")

        review_input = repo_root / str(company["reviewInput"])
        if not review_input.is_file():
            raise SystemExit(f"review input does not exist for {code}: {review_input}")

        status = str(company["status"])
        if status in ASSIGNED_STATUSES:
            if company.get("reviewFile") or company.get("independentReviewFile"):
                raise SystemExit(
                    f"assigned company has premature review outputs for {code}"
                )
        elif status == COMPLETED_STATUS:
            validate_primary_review_record(company, repo_root)
            validate_independent_review_packet(company, repo_root)
            completed_count += 1
            independent_ready_count += 1
        else:
            raise SystemExit(f"unsupported wave status for {code}: {status}")

    if len(set(codes)) != len(codes):
        raise SystemExit("duplicate company codes in wave")
    if len(set(orders)) != len(orders):
        raise SystemExit("duplicate company orders in wave")

    counts = wave.get("counts")
    if not isinstance(counts, dict):
        raise SystemExit("counts must be an object")
    if counts.get("assigned") != len(companies):
        raise SystemExit("counts.assigned does not match company count")
    if counts.get("primaryReviewComplete") != completed_count:
        raise SystemExit(
            "counts.primaryReviewComplete does not match completed wave entries"
        )
    if counts.get("independentReviewReady") != independent_ready_count:
        raise SystemExit(
            "counts.independentReviewReady does not match ready packets"
        )
    if counts.get("deepVerificationApproved") != 0:
        raise SystemExit("deepVerificationApproved must remain zero")

    assert_no_forbidden_true(wave)

    return {
        "assigned": len(companies),
        "primaryReviewComplete": completed_count,
        "independentReviewReady": independent_ready_count,
    }


def validate_status(
    status: dict[str, Any],
    wave: dict[str, Any],
    wave_counts: dict[str, int],
    repo_root: Path,
) -> None:
    if status.get("automaticDeepApprovalAllowed") is not False:
        raise SystemExit(
            "current status must explicitly prohibit automatic deep approval"
        )

    collection = status.get("collection", {})
    relevance = status.get("sourceRelevanceAudit", {})
    review = status.get("review", {})

    if collection.get("companiesCollected") != 450:
        raise SystemExit("collection.companiesCollected must be 450")
    if collection.get("uniqueCompaniesCollected") != 450:
        raise SystemExit("collection.uniqueCompaniesCollected must be 450")
    if relevance.get("auditedCompanies") != 450:
        raise SystemExit("sourceRelevanceAudit.auditedCompanies must be 450")

    classified = sum(
        int(relevance.get(key, 0))
        for key in (
            "primaryReviewCandidates",
            "humanRelevanceReviewRequired",
            "likelyWrongDocument",
            "pdfIdentificationRequired",
            "sourceRecoveryRequired",
        )
    )
    if classified != 450:
        raise SystemExit(
            f"source relevance classification total must be 450, got {classified}"
        )

    if review.get("primaryReviewWaveAssigned") != wave.get("targetCompanies"):
        raise SystemExit("status assigned count does not match wave target")

    completed_records = status.get("completedPrimaryReviews")
    if not isinstance(completed_records, list):
        raise SystemExit("completedPrimaryReviews must be an array")

    completed_codes: list[str] = []
    independent_ready_total = 0
    for index, record in enumerate(completed_records):
        if not isinstance(record, dict):
            raise SystemExit(f"completedPrimaryReviews[{index}] must be an object")

        code = str(record.get("code", ""))
        review_file_value = record.get("reviewFile")
        if not code or not isinstance(review_file_value, str):
            raise SystemExit(
                f"completedPrimaryReviews[{index}] lacks code or reviewFile"
            )
        completed_codes.append(code)

        review_record = load_json(repo_root / review_file_value)
        review_company = review_record.get("company")
        if not isinstance(review_company, dict) or str(review_company.get("code")) != code:
            raise SystemExit(f"canonical review company code mismatch for {code}")
        review_state = review_record.get("review", {})
        review_status = str(review_state.get("status", ""))
        if not review_status.startswith("primary_review_complete"):
            raise SystemExit(
                f"canonical completed review is not complete for {code}: "
                f"{review_status}"
            )

        independent_file_value = record.get("independentReviewFile")
        if independent_file_value is not None:
            if not isinstance(independent_file_value, str):
                raise SystemExit(f"invalid independentReviewFile for {code}")
            packet_path = repo_root / independent_file_value
            packet = load_json(packet_path)
            validate_independent_packet_content(packet, code, packet_path)
            independent_ready_total += 1

        assert_no_forbidden_true(record, f"completedPrimaryReviews[{index}]")
        assert_no_forbidden_true(review_record, f"canonicalReview[{code}]")

    if len(set(completed_codes)) != len(completed_codes):
        raise SystemExit("duplicate company codes in completedPrimaryReviews")

    completed_total = len(completed_records)
    if review.get("primaryReviewComplete") != completed_total:
        raise SystemExit(
            "review.primaryReviewComplete does not match canonical completed records"
        )
    if review.get("sourceIdentityConfirmed") != completed_total:
        raise SystemExit(
            "review.sourceIdentityConfirmed does not match canonical completed records"
        )
    if review.get("formalPlanConfirmed") != completed_total:
        raise SystemExit(
            "review.formalPlanConfirmed does not match canonical completed records"
        )
    if review.get("independentReviewReady") != independent_ready_total:
        raise SystemExit(
            "review.independentReviewReady does not match canonical ready packets"
        )

    additional_target = status.get("additionalCompaniesTarget")
    if not isinstance(additional_target, int):
        raise SystemExit("additionalCompaniesTarget must be an integer")
    if review.get("remainingPrimaryReviews") != additional_target - completed_total:
        raise SystemExit(
            "review.remainingPrimaryReviews does not match target minus completed"
        )

    if review.get("deepVerificationApproved") != 0:
        raise SystemExit("review.deepVerificationApproved must remain zero")
    if review.get("independentReviewComplete") != 0:
        raise SystemExit(
            "independentReviewComplete must remain zero until distinct review occurs"
        )

    active_work = status.get("activeWork")
    if not isinstance(active_work, list):
        raise SystemExit("activeWork must be an array")
    wave_work = next(
        (
            item
            for item in active_work
            if isinstance(item, dict)
            and item.get("workstream") == "primary_review_wave01"
        ),
        None,
    )
    if wave_work is None:
        raise SystemExit("activeWork lacks primary_review_wave01")
    if wave_work.get("completionCount") != wave_counts["primaryReviewComplete"]:
        raise SystemExit(
            "activeWork wave completionCount does not match wave completion"
        )
    if wave_work.get("remainingCount") != (
        wave_counts["assigned"] - wave_counts["primaryReviewComplete"]
    ):
        raise SystemExit(
            "activeWork wave remainingCount does not match wave completion"
        )

    assert_no_forbidden_true(status)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--wave",
        default="operations/quality-rebase/phase2/primary-review-wave01-v1.json",
        help="Path to the primary-review wave JSON",
    )
    parser.add_argument(
        "--status",
        default="operations/quality-rebase/phase2/current-status-v1.json",
        help="Path to the Phase 2 current-status JSON",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root used to resolve review files",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    wave = load_json(repo_root / args.wave)
    status = load_json(repo_root / args.status)

    wave_counts = validate_wave(wave, repo_root)
    validate_status(status, wave, wave_counts, repo_root)

    print(
        json.dumps(
            {
                "status": "ok",
                "wave": wave["wave"],
                "assignedCompanies": wave_counts["assigned"],
                "wavePrimaryReviewComplete": wave_counts["primaryReviewComplete"],
                "waveIndependentReviewReady": wave_counts["independentReviewReady"],
                "sourceRelevanceAudited": status["sourceRelevanceAudit"][
                    "auditedCompanies"
                ],
                "primaryReviewComplete": status["review"]["primaryReviewComplete"],
                "independentReviewReady": status["review"][
                    "independentReviewReady"
                ],
                "deepVerificationApproved": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
