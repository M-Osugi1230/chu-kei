#!/usr/bin/env python3
"""Validate append-only Phase 2 independent-review completion records.

Independent-review request packets remain immutable/pending audit artifacts.
A distinct reviewer records completion in independent-completions/*.json and the
aggregate independent-review-status-v1.json points to those records.

This gate intentionally never grants deep verification. It only verifies that a
claimed independent review has coherent source identity, completed checks,
reviewer separation controls, and consistent aggregate counts.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CONFIRMED_CHECK_STATUSES = {"confirmed", "confirmed_after_override"}
FORBIDDEN_TRUE_KEYS = {
    "automaticFactCompletionAllowed",
    "automaticApprovalAllowed",
    "deepVerificationApproved",
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
                raise SystemExit(f"forbidden true flag at {child_location}")
            assert_no_forbidden_true(child, child_location)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_true(child, f"{location}[{index}]")


def require_https(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value.startswith("https://"):
        raise SystemExit(f"{location} must be an https URL")
    return value


def validate_source(source: dict[str, Any], location: str) -> None:
    require_https(source.get("officialUrl"), f"{location}.officialUrl")
    sha = source.get("pdfSha256")
    if not isinstance(sha, str) or SHA256_RE.fullmatch(sha) is None:
        raise SystemExit(f"{location}.pdfSha256 must be a lowercase SHA-256")
    page_count = source.get("pageCount")
    if not isinstance(page_count, int) or page_count <= 0:
        raise SystemExit(f"{location}.pageCount must be positive")


def validate_pending_packet(packet: dict[str, Any], code: str, path: Path) -> None:
    company = packet.get("company")
    if not isinstance(company, dict) or str(company.get("code")) != code:
        raise SystemExit(f"independent packet company mismatch for {code}: {path}")
    if packet.get("status") != "independent_review_ready":
        raise SystemExit(f"independent packet must remain ready/pending for {code}")

    checks = packet.get("checks")
    if isinstance(checks, list):
        if not checks:
            raise SystemExit(f"independent packet has no checks for {code}")
        for check in checks:
            if not isinstance(check, dict) or check.get("status") != "pending":
                raise SystemExit(
                    f"original independent packet must remain pending for {code}"
                )
    else:
        legacy_checks = packet.get("requiredChecks")
        if not isinstance(legacy_checks, list) or not legacy_checks:
            raise SystemExit(f"unsupported independent packet schema for {code}")
        for check in legacy_checks:
            if not isinstance(check, dict) or check.get("completed") is not False:
                raise SystemExit(
                    f"legacy independent packet must remain incomplete for {code}"
                )

    assert_no_forbidden_true(packet, f"pendingPacket[{code}]")


def validate_collection_identity(
    repo_root: Path,
    completion: dict[str, Any],
    code: str,
) -> None:
    cross_checks = completion.get("crossChecks")
    if not isinstance(cross_checks, dict):
        raise SystemExit(f"crossChecks missing for {code}")
    integrity = cross_checks.get("collectionIntegrity")
    if not isinstance(integrity, dict):
        raise SystemExit(f"collectionIntegrity missing for {code}")

    collection_file = integrity.get("file")
    if not isinstance(collection_file, str) or not collection_file:
        raise SystemExit(f"collectionIntegrity.file missing for {code}")
    collection_path = repo_root / collection_file
    collection = load_json(collection_path)
    collection_company = collection.get("company")
    if not isinstance(collection_company, dict) or str(collection_company.get("code")) != code:
        raise SystemExit(f"collection company mismatch for {code}: {collection_path}")

    source = completion["source"]
    collection_url = collection.get("resolvedPdfUrl") or collection.get("resolvedPageUrl")
    if source.get("officialUrl") != collection_url:
        raise SystemExit(f"completion URL does not match canonical collection for {code}")
    if source.get("pdfSha256") != collection.get("pdfSha256"):
        raise SystemExit(f"completion SHA-256 does not match collection for {code}")
    if source.get("pageCount") != collection.get("pageCount"):
        raise SystemExit(f"completion pageCount does not match collection for {code}")

    for flag in ("sourceUrlMatched", "pdfSha256Matched", "pageCountMatched"):
        if integrity.get(flag) is not True:
            raise SystemExit(f"collection integrity flag {flag} must be true for {code}")


def validate_override(
    repo_root: Path,
    completion: dict[str, Any],
    code: str,
) -> None:
    override_file = completion.get("sourceIdentityOverride")
    if override_file is None:
        return
    if not isinstance(override_file, str) or not override_file:
        raise SystemExit(f"invalid sourceIdentityOverride for {code}")
    override_path = repo_root / override_file
    override = load_json(override_path)
    override_company = override.get("company")
    if not isinstance(override_company, dict) or str(override_company.get("code")) != code:
        raise SystemExit(f"source override company mismatch for {code}")
    canonical = override.get("canonicalSource")
    if not isinstance(canonical, dict):
        raise SystemExit(f"canonicalSource missing in override for {code}")
    source = completion["source"]
    for field in ("officialUrl", "pdfSha256", "pageCount"):
        if source.get(field) != canonical.get(field):
            raise SystemExit(f"completion {field} differs from override for {code}")
    assert_no_forbidden_true(override, f"sourceOverride[{code}]")


def validate_completion(
    repo_root: Path,
    record: dict[str, Any],
) -> str:
    code = str(record.get("code", "")).strip()
    if not code:
        raise SystemExit("completion status record lacks code")
    file_value = record.get("file")
    if not isinstance(file_value, str) or not file_value:
        raise SystemExit(f"completion status record lacks file for {code}")
    completion_path = repo_root / file_value
    completion = load_json(completion_path)

    if completion.get("schemaVersion") != "quality-rebase-phase2-independent-completion-v1":
        raise SystemExit(f"unexpected independent completion schema for {code}")
    company = completion.get("company")
    if not isinstance(company, dict) or str(company.get("code")) != code:
        raise SystemExit(f"completion company mismatch for {code}")
    if completion.get("status") != "independent_review_complete":
        raise SystemExit(f"completion is not complete for {code}")

    source = completion.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"source missing for completion {code}")
    validate_source(source, f"completion[{code}].source")

    checks = completion.get("checks")
    if not isinstance(checks, list) or not checks:
        raise SystemExit(f"completed independent review has no checks for {code}")
    check_ids: set[str] = set()
    for check in checks:
        if not isinstance(check, dict):
            raise SystemExit(f"invalid check entry for {code}")
        check_id = str(check.get("id", "")).strip()
        if not check_id or check_id in check_ids:
            raise SystemExit(f"missing/duplicate independent check id for {code}")
        check_ids.add(check_id)
        if check.get("status") not in CONFIRMED_CHECK_STATUSES:
            raise SystemExit(f"unconfirmed independent check {check_id} for {code}")
        result = check.get("result")
        if not isinstance(result, str) or not result.strip():
            raise SystemExit(f"independent check lacks result {check_id} for {code}")
        pages = check.get("evidencePdfPages")
        if pages is not None:
            if (
                not isinstance(pages, list)
                or not pages
                or any(not isinstance(page, int) or page <= 0 for page in pages)
            ):
                raise SystemExit(f"invalid evidencePdfPages for {check_id} / {code}")
            if any(page > source["pageCount"] for page in pages):
                raise SystemExit(f"evidence page exceeds pageCount for {check_id} / {code}")

    review = completion.get("review")
    if not isinstance(review, dict):
        raise SystemExit(f"review section missing for completion {code}")
    if review.get("minimumDistinctReviewers", 0) < 2:
        raise SystemExit(f"minimumDistinctReviewers invalid for {code}")
    if review.get("reviewRole") != "independent_reviewer":
        raise SystemExit(f"reviewRole must be independent_reviewer for {code}")
    if review.get("primaryReviewerMustNotSelfApprove") is not True:
        raise SystemExit(f"self-approval prohibition missing for {code}")
    if not isinstance(review.get("completedAt"), str) or not review["completedAt"]:
        raise SystemExit(f"completedAt missing for {code}")
    if review.get("automaticApprovalAllowed") is not False:
        raise SystemExit(f"automaticApprovalAllowed must be false for {code}")
    if review.get("deepVerificationApproved") is not False:
        raise SystemExit(f"deepVerificationApproved must remain false for {code}")

    packet_file = completion.get("independentReviewPacket")
    if not isinstance(packet_file, str) or not packet_file:
        raise SystemExit(f"independentReviewPacket missing for {code}")
    validate_pending_packet(load_json(repo_root / packet_file), code, repo_root / packet_file)

    validate_collection_identity(repo_root, completion, code)
    validate_override(repo_root, completion, code)
    assert_no_forbidden_true(completion, f"completion[{code}]")
    return code


def validate_status(repo_root: Path, status_path: Path) -> dict[str, int]:
    status = load_json(status_path)
    if status.get("schemaVersion") != "quality-rebase-phase2-independent-review-status-v1":
        raise SystemExit("unexpected independent-review status schemaVersion")

    counts = status.get("counts")
    if not isinstance(counts, dict):
        raise SystemExit("independent-review status counts missing")
    for field in (
        "independentReviewComplete",
        "independentReviewPending",
        "independentReviewBlockedSourceIdentity",
        "deepVerificationApproved",
    ):
        if not isinstance(counts.get(field), int) or counts[field] < 0:
            raise SystemExit(f"invalid count: {field}")
    if counts["deepVerificationApproved"] != 0:
        raise SystemExit("deepVerificationApproved must remain zero")

    basis = status.get("basis")
    if not isinstance(basis, dict):
        raise SystemExit("basis missing")
    eligible = basis.get("independentReviewEligible")
    if not isinstance(eligible, int) or eligible < 0:
        raise SystemExit("independentReviewEligible must be non-negative")

    completion_records = status.get("completionRecords")
    if not isinstance(completion_records, list):
        raise SystemExit("completionRecords must be an array")
    if len(completion_records) != counts["independentReviewComplete"]:
        raise SystemExit("completionRecords length does not match independentReviewComplete")

    completed_codes: set[str] = set()
    for record in completion_records:
        if not isinstance(record, dict):
            raise SystemExit("invalid completionRecords entry")
        code = validate_completion(repo_root, record)
        if code in completed_codes:
            raise SystemExit(f"duplicate independent completion code: {code}")
        completed_codes.add(code)

    blocked_records = status.get("blockedRecords", [])
    if not isinstance(blocked_records, list):
        raise SystemExit("blockedRecords must be an array")
    if len(blocked_records) != counts["independentReviewBlockedSourceIdentity"]:
        raise SystemExit(
            "blockedRecords length does not match independentReviewBlockedSourceIdentity"
        )
    blocked_codes: set[str] = set()
    for record in blocked_records:
        if not isinstance(record, dict):
            raise SystemExit("invalid blockedRecords entry")
        code = str(record.get("code", "")).strip()
        repair_file = record.get("repairFile")
        if not code or not isinstance(repair_file, str) or not repair_file:
            raise SystemExit("blocked record lacks code or repairFile")
        if code in completed_codes:
            raise SystemExit(f"company cannot be both completed and blocked: {code}")
        if code in blocked_codes:
            raise SystemExit(f"duplicate blocked code: {code}")
        blocked_codes.add(code)
        repair = load_json(repo_root / repair_file)
        if repair.get("independentReviewCompletionBlocked") is not True:
            raise SystemExit(f"blocked repair file is not blocking completion: {code}")
        assert_no_forbidden_true(repair, f"blockedRepair[{code}]")

    accounted = (
        counts["independentReviewComplete"]
        + counts["independentReviewPending"]
        + counts["independentReviewBlockedSourceIdentity"]
    )
    if accounted != eligible:
        raise SystemExit(
            f"independent review accounting mismatch: eligible={eligible}, accounted={accounted}"
        )

    resolved_records = status.get("resolvedSourceIdentityRecords", [])
    if not isinstance(resolved_records, list):
        raise SystemExit("resolvedSourceIdentityRecords must be an array")
    for record in resolved_records:
        if not isinstance(record, dict):
            raise SystemExit("invalid resolvedSourceIdentityRecords entry")
        code = str(record.get("code", "")).strip()
        override_file = record.get("overrideFile")
        repair_file = record.get("repairFile")
        if not code or code not in completed_codes:
            raise SystemExit(f"resolved source identity is not completed: {code}")
        if not isinstance(override_file, str) or not override_file:
            raise SystemExit(f"resolved source identity lacks overrideFile: {code}")
        if not isinstance(repair_file, str) or not repair_file:
            raise SystemExit(f"resolved source identity lacks repairFile: {code}")
        override = load_json(repo_root / override_file)
        repair = load_json(repo_root / repair_file)
        if repair.get("independentReviewCompletionBlocked") is not False:
            raise SystemExit(f"resolved repair remains blocked: {code}")
        assert_no_forbidden_true(override, f"resolvedOverride[{code}]")
        assert_no_forbidden_true(repair, f"resolvedRepair[{code}]")

    policy = status.get("policy")
    if not isinstance(policy, dict):
        raise SystemExit("policy missing")
    for field in (
        "appendOnlyCompletionRecords",
        "preserveOriginalPendingPackets",
        "primaryReviewerMaySelfApprove",
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        if field not in policy:
            raise SystemExit(f"policy field missing: {field}")
    if policy["appendOnlyCompletionRecords"] is not True:
        raise SystemExit("appendOnlyCompletionRecords must be true")
    if policy["preserveOriginalPendingPackets"] is not True:
        raise SystemExit("preserveOriginalPendingPackets must be true")
    if policy["primaryReviewerMaySelfApprove"] is not False:
        raise SystemExit("primaryReviewerMaySelfApprove must be false")
    if policy["automaticFactCompletionAllowed"] is not False:
        raise SystemExit("automaticFactCompletionAllowed must be false")
    if policy["automaticApprovalAllowed"] is not False:
        raise SystemExit("automaticApprovalAllowed must be false")
    if policy["deepVerificationApproved"] is not False:
        raise SystemExit("deepVerificationApproved policy must be false")

    assert_no_forbidden_true(status, "independentReviewStatus")
    return {
        "eligible": eligible,
        "complete": counts["independentReviewComplete"],
        "pending": counts["independentReviewPending"],
        "blocked": counts["independentReviewBlockedSourceIdentity"],
        "deepVerificationApproved": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--status",
        default="operations/quality-rebase/phase2/independent-review-status-v1.json",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    result = validate_status(repo_root, repo_root / args.status)
    print(json.dumps({"status": "ok", **result}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
