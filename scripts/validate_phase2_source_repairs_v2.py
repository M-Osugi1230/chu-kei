#!/usr/bin/env python3
"""Extend the Phase 2 source-repair gate for append-only repair history.

Legacy and corrected source-repair schemas remain subject to their original
validator. Independent-review source resolutions are validated here as an
additional strict schema.

A historical quarantine may coexist with a later human-reviewed completion only
when the later completion proves a new canonical collection identity and passes
all review-safety checks. In that case the old quarantine is retained as audit
history and reported as superseded; it is never silently ignored.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import validate_phase2_source_repairs as legacy

INDEPENDENT_SCHEMA = "quality-rebase-phase2-independent-source-resolution-v1"
INDEPENDENT_COMPLETION_SCHEMA = "quality-rebase-phase2-independent-completion-v1"


def require_string(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"missing string: {location}")
    return value.strip()


def load_completion(repo_root: Path, code: str) -> tuple[Path, dict[str, Any]] | None:
    path = (
        repo_root
        / "operations/quality-rebase/phase2/independent-completions"
        / f"{code}-independent-completion-v1.json"
    )
    if not path.exists():
        return None
    completion = legacy.load_json(path)
    if completion.get("schemaVersion") != INDEPENDENT_COMPLETION_SCHEMA:
        raise SystemExit(f"unexpected independent completion schema: {path}")
    company = completion.get("company")
    if not isinstance(company, dict) or str(company.get("code", "")) != code:
        raise SystemExit(f"independent completion company mismatch: {code}")
    if completion.get("status") != "independent_review_complete":
        raise SystemExit(f"independent completion is not complete: {code}")
    return path, completion


def validate_completion_safety(completion: dict[str, Any], code: str) -> None:
    review = completion.get("review")
    if not isinstance(review, dict):
        raise SystemExit(f"independent completion review section missing: {code}")
    if review.get("automaticApprovalAllowed") is not False:
        raise SystemExit(f"independent completion automatic approval must be false: {code}")
    if review.get("deepVerificationApproved") is not False:
        raise SystemExit(f"independent completion deep verification must be false: {code}")
    checks = completion.get("checks")
    if not isinstance(checks, list) or not checks:
        raise SystemExit(f"independent completion checks missing: {code}")
    for check in checks:
        if not isinstance(check, dict) or check.get("status") != "confirmed":
            raise SystemExit(f"independent completion contains unconfirmed check: {code}")
    blockers = completion.get("finalDeepVerificationBlockers")
    if blockers is not None and not isinstance(blockers, list):
        raise SystemExit(f"finalDeepVerificationBlockers must be an array: {code}")
    legacy.assert_no_automatic_approval(completion, f"independentCompletion[{code}]")


def validate_collection_integrity(
    completion: dict[str, Any], repo_root: Path, code: str
) -> None:
    cross = completion.get("crossChecks")
    if not isinstance(cross, dict):
        raise SystemExit(f"crossChecks missing for completion: {code}")
    integrity = cross.get("collectionIntegrity")
    if not isinstance(integrity, dict):
        raise SystemExit(f"collectionIntegrity missing for completion: {code}")
    collection_file = require_string(
        integrity.get("file"), f"completion[{code}].collectionIntegrity.file"
    )
    for key in ("sourceUrlMatched", "pdfSha256Matched", "pageCountMatched"):
        if integrity.get(key) is not True:
            raise SystemExit(f"completion[{code}].collectionIntegrity.{key} must be true")

    collection = legacy.load_json(repo_root / collection_file)
    collection_company = collection.get("company")
    if isinstance(collection_company, dict):
        collection_code = str(collection_company.get("code", ""))
    else:
        collection_code = str(collection.get("company", {}).get("code", "")) if isinstance(collection.get("company"), dict) else ""
    if collection_code != code:
        raise SystemExit(f"collection company mismatch for completion: {code}")

    source = completion.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"completion source missing: {code}")
    expected_url = collection.get("resolvedPdfUrl") or collection.get("sourceUrl")
    if source.get("officialUrl") != expected_url:
        raise SystemExit(f"completion source URL does not match collection: {code}")
    if source.get("pdfSha256") != collection.get("pdfSha256"):
        raise SystemExit(f"completion SHA-256 does not match collection: {code}")
    if source.get("pageCount") != collection.get("pageCount"):
        raise SystemExit(f"completion page count does not match collection: {code}")

    primary_path = require_string(
        completion.get("primaryReviewFile"), f"completion[{code}].primaryReviewFile"
    )
    primary = legacy.load_json(repo_root / primary_path)
    primary_company = primary.get("company")
    if not isinstance(primary_company, dict) or str(primary_company.get("code", "")) != code:
        raise SystemExit(f"primary review company mismatch for completion: {code}")
    primary_review = primary.get("review")
    primary_status = ""
    if isinstance(primary_review, dict):
        primary_status = str(primary_review.get("status", ""))
    if not primary_status.startswith("primary_review_complete"):
        raise SystemExit(f"primary review is not complete for superseded quarantine: {code}")


def validate_completion(
    repair: dict[str, Any], repair_path: Path, repo_root: Path, code: str
) -> None:
    loaded = load_completion(repo_root, code)
    if loaded is None:
        raise SystemExit(f"resolved source lacks independent completion: {code}")
    _, completion = loaded
    validate_completion_safety(completion, code)

    source = completion.get("source")
    canonical = repair.get("canonicalSource")
    if not isinstance(source, dict) or not isinstance(canonical, dict):
        raise SystemExit(f"resolved source metadata missing for {code}")
    legacy.validate_pdf_identity(canonical, f"{repair_path}.canonicalSource")
    for key in ("officialUrl", "pdfSha256", "pageCount"):
        if source.get(key) != canonical.get(key):
            raise SystemExit(f"completion/canonical source mismatch for {code}: {key}")

    validate_collection_integrity(completion, repo_root, code)

    evidence_correction = repair.get("evidenceCorrectionFile")
    if evidence_correction is not None:
        correction_path = repo_root / require_string(
            evidence_correction, f"{repair_path}.evidenceCorrectionFile"
        )
        correction = legacy.load_json(correction_path)
        correction_company = correction.get("company")
        if not isinstance(correction_company, dict) or str(
            correction_company.get("code", "")
        ) != code:
            raise SystemExit(f"evidence correction company mismatch: {code}")
        legacy.assert_no_automatic_approval(correction, str(correction_path))


def validate_independent_resolution(
    repair: dict[str, Any], repair_path: Path, repo_root: Path
) -> dict[str, Any]:
    legacy.assert_no_automatic_approval(repair, str(repair_path))
    code = legacy.company_code(repair, repair_path)
    require_string(repair.get("resolutionStatus"), f"{repair_path}.resolutionStatus")

    for key in (
        "automaticFactCompletionAllowed",
        "automaticApprovalAllowed",
        "deepVerificationApproved",
    ):
        legacy.require_false(repair, key, str(repair_path))

    blocked = repair.get("independentReviewCompletionBlocked")
    if not isinstance(blocked, bool):
        raise SystemExit(
            f"independentReviewCompletionBlocked must be boolean: {repair_path}"
        )

    loaded_completion = load_completion(repo_root, code)
    if blocked:
        checks = repair.get("requiredNextChecks")
        if not isinstance(checks, list) or not checks:
            raise SystemExit(f"blocked source resolution lacks requiredNextChecks: {code}")
        if loaded_completion is not None:
            raise SystemExit(f"blocked source already has independent completion: {code}")
        return {
            "code": code,
            "mode": "independent_source_blocked",
            "quarantined": True,
            "resolutionStatus": repair.get("resolutionStatus"),
            "file": repair_path.name,
        }

    require_string(repair.get("resolvedAt"), f"{repair_path}.resolvedAt")
    canonical = repair.get("canonicalSource")
    if not isinstance(canonical, dict):
        raise SystemExit(f"resolved record lacks canonicalSource: {code}")
    legacy.validate_pdf_identity(canonical, f"{repair_path}.canonicalSource")
    validate_completion(repair, repair_path, repo_root, code)

    return {
        "code": code,
        "mode": "independent_source_resolved",
        "quarantined": False,
        "resolutionStatus": repair.get("resolutionStatus"),
        "file": repair_path.name,
    }


def quarantine_kind(repair: dict[str, Any]) -> str | None:
    schema = repair.get("schemaVersion")
    if schema == legacy.LEGACY_SCHEMA:
        incorrect = repair.get("incorrectCandidate")
        if isinstance(incorrect, dict) and incorrect.get("mayEnterPrimaryReview") is False:
            return "legacy_quarantine"
    if schema == legacy.CORRECTED_SCHEMA:
        resolution = repair.get("resolution")
        if (
            isinstance(resolution, dict)
            and resolution.get("status")
            == "source_isolated_quantified_plan_republication_required"
            and resolution.get("waveEligibility") is False
        ):
            return "quantified_plan_quarantine"
    return None


def validate_superseded_quarantine(
    repair: dict[str, Any], repair_path: Path, repo_root: Path, kind: str
) -> dict[str, Any]:
    code = legacy.company_code(repair, repair_path)
    loaded = load_completion(repo_root, code)
    if loaded is None:
        raise SystemExit(f"superseded quarantine lacks completion: {code}")
    _, completion = loaded
    validate_completion_safety(completion, code)
    validate_collection_integrity(completion, repo_root, code)

    # Re-run the quarantine's original structural rules except the historical
    # prohibition on a later completion.
    legacy.assert_no_automatic_approval(repair, str(repair_path))
    if kind == "legacy_quarantine":
        for key in (
            "primaryReviewComplete",
            "independentReviewReady",
            "automaticFactCompletionAllowed",
            "automaticApprovalAllowed",
            "deepVerificationApproved",
        ):
            legacy.require_false(repair, key, str(repair_path))
        incorrect = repair.get("incorrectCandidate")
        if not isinstance(incorrect, dict) or incorrect.get("mayEnterPrimaryReview") is not False:
            raise SystemExit(f"historical quarantine structure invalid: {code}")
        checks = repair.get("requiredNextChecks")
        if not isinstance(checks, list) or not checks:
            raise SystemExit(f"historical quarantine lacks requiredNextChecks: {code}")
    else:
        candidate = repair.get("candidate")
        if not isinstance(candidate, dict):
            raise SystemExit(f"historical quantified quarantine lacks candidate: {code}")
        legacy.validate_pdf_identity(candidate, f"{repair_path}.candidate")
        finding = repair.get("finding")
        if not isinstance(finding, dict):
            raise SystemExit(f"historical quantified quarantine lacks finding: {code}")
        if finding.get("type") != "quantified_formal_plan_boundary_not_met":
            raise SystemExit(f"historical quantified quarantine finding invalid: {code}")
        legacy.require_true(finding, "sourceIdentityConfirmed", f"{repair_path}.finding")
        legacy.require_true(finding, "managementRoadmapConfirmed", f"{repair_path}.finding")
        legacy.require_false(
            finding,
            "quantifiedMediumTermTargetsConfirmed",
            f"{repair_path}.finding",
        )
        evidence = finding.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise SystemExit(f"historical quantified quarantine lacks evidence: {code}")
        resolution = repair.get("resolution")
        if not isinstance(resolution, dict):
            raise SystemExit(f"historical quantified quarantine lacks resolution: {code}")
        if resolution.get("status") != "source_isolated_quantified_plan_republication_required":
            raise SystemExit(f"historical quantified quarantine resolution invalid: {code}")
        legacy.require_false(resolution, "waveEligibility", f"{repair_path}.resolution")
        legacy.require_true(resolution, "replacementRequired", f"{repair_path}.resolution")
        next_actions = resolution.get("nextActions")
        if not isinstance(next_actions, list) or not next_actions:
            raise SystemExit(f"historical quantified quarantine lacks nextActions: {code}")
        approval = repair.get("approval")
        if not isinstance(approval, dict):
            raise SystemExit(f"historical quantified quarantine lacks approval: {code}")
        legacy.require_false(approval, "automaticApprovalAllowed", f"{repair_path}.approval")
        legacy.require_false(approval, "deepVerificationApproved", f"{repair_path}.approval")

    return {
        "code": code,
        "mode": f"{kind}_superseded_by_independent_review",
        "quarantined": False,
        "resolutionStatus": "historical_quarantine_superseded",
        "file": repair_path.name,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--status",
        default="operations/quality-rebase/phase2/current-status-v1.json",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    status = legacy.load_json(repo_root / args.status)
    if status.get("automaticDeepApprovalAllowed") is not False:
        raise SystemExit("canonical status must prohibit automatic deep approval")
    legacy.assert_no_automatic_approval(status, "current-status")
    completed_records = legacy.canonical_completed_records(status)

    repair_dir = repo_root / "operations/quality-rebase/phase2/source-repairs"
    repair_paths = sorted(repair_dir.glob("*-source-resolution-v1.json"))
    if not repair_paths:
        raise SystemExit("no source-resolution records found")

    results: list[dict[str, Any]] = []
    for repair_path in repair_paths:
        repair = legacy.load_json(repair_path)
        schema = repair.get("schemaVersion")
        if schema == INDEPENDENT_SCHEMA:
            result = validate_independent_resolution(repair, repair_path, repo_root)
        else:
            kind = quarantine_kind(repair)
            code = legacy.company_code(repair, repair_path)
            if kind is not None and load_completion(repo_root, code) is not None:
                result = validate_superseded_quarantine(
                    repair, repair_path, repo_root, kind
                )
            else:
                result = legacy.validate_repair(
                    repair_path, repo_root, completed_records
                )
                result = {**result, "file": repair_path.name}
        results.append(result)

    print(
        json.dumps(
            {
                "status": "ok",
                "sourceResolutionRecords": len(results),
                "companiesRepresented": len({str(result["code"]) for result in results}),
                "quarantinedCompanies": len(
                    {
                        str(result["code"])
                        for result in results
                        if result["quarantined"]
                    }
                ),
                "independentSourceBlocked": sum(
                    1
                    for result in results
                    if result["mode"] == "independent_source_blocked"
                ),
                "independentSourceResolved": sum(
                    1
                    for result in results
                    if result["mode"] == "independent_source_resolved"
                ),
                "historicalQuarantinesSuperseded": sum(
                    1
                    for result in results
                    if "superseded_by_independent_review" in result["mode"]
                ),
                "deepVerificationApproved": 0,
                "records": results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
