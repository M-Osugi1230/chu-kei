#!/usr/bin/env python3
"""Strict compatibility layer for Phase 2 independent completions.

New completion records may carry crossChecks.collectionIntegrity explicitly.
Historical append-only records predate that field. For those records, this gate
reconstructs collection integrity only when the completion source identity
(official URL, exact SHA-256, page count, company code) matches a canonical
bulk-collection record. No source fields are inferred or weakened.

A small number of append-only historical records also predate the current
``confirmed_after_override`` check-status spelling. The legacy
``confirmed_with_override`` spelling is accepted only for the ``source_identity``
check and only after the referenced sourceIdentityOverride itself passes the
strict base override validator. The historical record is never rewritten and
no other check gains the legacy status.

The historical aggregate status also predates explicit links on resolved-source
records. Those links are reconstructed in memory only from each completed
record's audited references. Override-based resolutions still pass the base
status validator; correction/source-resolution records without an override are
validated here against their exact canonical source and are not mislabeled as
overrides. Historical artifacts are never rewritten.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import validate_phase2_independent_completions as base

_ORIGINAL_LOAD_JSON = base.load_json
_ORIGINAL_VALIDATE_COLLECTION_IDENTITY = base.validate_collection_identity
_ORIGINAL_VALIDATE_COMPLETION = base.validate_completion
_ORIGINAL_VALIDATE_STATUS = base.validate_status
_LEGACY_SOURCE_IDENTITY_STATUS = "confirmed_with_override"


def collection_matches_source(
    collection: dict[str, Any], source: dict[str, Any], code: str
) -> bool:
    company = collection.get("company")
    if not isinstance(company, dict) or str(company.get("code")) != code:
        return False
    collection_url = collection.get("resolvedPdfUrl") or collection.get("resolvedPageUrl")
    return (
        collection_url == source.get("officialUrl")
        and collection.get("pdfSha256") == source.get("pdfSha256")
        and collection.get("pageCount") == source.get("pageCount")
    )


def strict_collection_identity_compat(
    repo_root: Path,
    completion: dict[str, Any],
    code: str,
) -> None:
    cross_checks = completion.get("crossChecks")
    integrity = cross_checks.get("collectionIntegrity") if isinstance(cross_checks, dict) else None
    if isinstance(integrity, dict):
        _ORIGINAL_VALIDATE_COLLECTION_IDENTITY(repo_root, completion, code)
        return

    source = completion.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"source missing for completion {code}")
    sha = source.get("pdfSha256")
    if not isinstance(sha, str) or base.SHA256_RE.fullmatch(sha) is None:
        raise SystemExit(f"legacy collection identity lacks exact SHA-256 for {code}")

    candidates: list[Path] = []
    resolution_file = completion.get("sourceResolutionFile")
    if resolution_file is not None:
        if not isinstance(resolution_file, str) or not resolution_file:
            raise SystemExit(f"invalid sourceResolutionFile for {code}")
        resolution_path = repo_root / resolution_file
        resolution = base.load_json(resolution_path)
        resolution_company = resolution.get("company")
        if not isinstance(resolution_company, dict) or str(resolution_company.get("code")) != code:
            raise SystemExit(f"source resolution company mismatch for {code}")
        canonical = resolution.get("canonicalSource")
        if not isinstance(canonical, dict):
            raise SystemExit(f"canonicalSource missing in source resolution for {code}")
        for field in ("officialUrl", "pdfSha256", "pageCount"):
            if canonical.get(field) != source.get(field):
                raise SystemExit(
                    f"completion {field} differs from source resolution canonical for {code}"
                )
        collection_file = resolution.get("collectionFile")
        if not isinstance(collection_file, str) or not collection_file:
            raise SystemExit(f"collectionFile missing in source resolution for {code}")
        candidates.append(repo_root / collection_file)
        base.assert_no_forbidden_true(resolution, f"sourceResolution[{code}]")
    else:
        bulk_root = repo_root / "operations" / "quality-rebase" / "phase2" / "bulk-collection"
        candidates.extend(sorted(bulk_root.glob(f"**/{code}/collection.json")))

    if not candidates:
        raise SystemExit(f"no canonical collection candidate found for {code}")

    matched = [
        path
        for path in candidates
        if collection_matches_source(base.load_json(path), source, code)
    ]
    if not matched:
        raise SystemExit(
            f"completion source identity does not match canonical collection for {code}"
        )


def strict_completion_status_compat(
    repo_root: Path,
    record: dict[str, Any],
) -> str:
    """Validate the one legacy override spelling without widening base policy."""
    code = str(record.get("code", "")).strip()
    file_value = record.get("file")
    if not code or not isinstance(file_value, str) or not file_value:
        return _ORIGINAL_VALIDATE_COMPLETION(repo_root, record)

    completion = base.load_json(repo_root / file_value)
    checks = completion.get("checks")
    legacy_checks = (
        [
            check
            for check in checks
            if isinstance(check, dict)
            and check.get("status") == _LEGACY_SOURCE_IDENTITY_STATUS
        ]
        if isinstance(checks, list)
        else []
    )
    if not legacy_checks:
        return _ORIGINAL_VALIDATE_COMPLETION(repo_root, record)

    if len(legacy_checks) != 1 or legacy_checks[0].get("id") != "source_identity":
        raise SystemExit(f"legacy override status is only valid for source_identity / {code}")
    override_file = completion.get("sourceIdentityOverride")
    if not isinstance(override_file, str) or not override_file:
        raise SystemExit(f"legacy source_identity status lacks sourceIdentityOverride for {code}")

    source = completion.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"source missing for completion {code}")
    base.validate_source(source, f"completion[{code}].source")
    base.validate_override(repo_root, completion, code)

    original_statuses = base.CONFIRMED_CHECK_STATUSES
    try:
        base.CONFIRMED_CHECK_STATUSES = original_statuses | {_LEGACY_SOURCE_IDENTITY_STATUS}
        return _ORIGINAL_VALIDATE_COMPLETION(repo_root, record)
    finally:
        base.CONFIRMED_CHECK_STATUSES = original_statuses


def _repair_reference_from_completion(completion: dict[str, Any], code: str) -> str:
    """Return an explicit audited repair/reference file; never guess a path."""
    resolution_file = completion.get("sourceResolutionFile")
    if isinstance(resolution_file, str) and resolution_file:
        return resolution_file

    cross_checks = completion.get("crossChecks")
    source_repair = cross_checks.get("sourceRepair") if isinstance(cross_checks, dict) else None
    repair_file = source_repair.get("file") if isinstance(source_repair, dict) else None
    if isinstance(repair_file, str) and repair_file:
        return repair_file

    raise SystemExit(f"legacy resolved source identity lacks audited repair reference: {code}")


def _validate_resolution_without_override(
    completion: dict[str, Any],
    repair: dict[str, Any],
    code: str,
) -> None:
    """Strictly validate a corrected canonical source that needed no override."""
    source = completion.get("source")
    canonical = repair.get("canonicalSource")
    if not isinstance(source, dict) or not isinstance(canonical, dict):
        raise SystemExit(f"canonical source evidence missing for resolved identity: {code}")
    base.validate_source(source, f"completion[{code}].source")
    for field in ("officialUrl", "pdfSha256", "pageCount"):
        if canonical.get(field) != source.get(field):
            raise SystemExit(f"resolved canonical {field} mismatch for {code}")
    if repair.get("independentReviewCompletionBlocked") is not False:
        raise SystemExit(f"resolved repair remains blocked: {code}")
    base.assert_no_forbidden_true(repair, f"legacyResolvedRepair[{code}]")


def strict_status_compat(
    repo_root: Path,
    status_path: Path,
) -> dict[str, int]:
    """Backfill legacy resolved links in memory while preserving resolution type."""
    status = _ORIGINAL_LOAD_JSON(status_path)
    resolved_records = status.get("resolvedSourceIdentityRecords")
    if not isinstance(resolved_records, list):
        return _ORIGINAL_VALIDATE_STATUS(repo_root, status_path)

    completion_records = status.get("completionRecords")
    if not isinstance(completion_records, list):
        return _ORIGINAL_VALIDATE_STATUS(repo_root, status_path)
    completion_files = {
        str(record.get("code", "")).strip(): record.get("file")
        for record in completion_records
        if isinstance(record, dict)
    }

    normalized_records: list[Any] = []
    changed = False
    for record in resolved_records:
        if not isinstance(record, dict):
            normalized_records.append(record)
            continue
        if record.get("overrideFile") and record.get("repairFile"):
            normalized_records.append(record)
            continue

        code = str(record.get("code", "")).strip()
        completion_file = completion_files.get(code)
        if not code or not isinstance(completion_file, str) or not completion_file:
            raise SystemExit(f"legacy resolved source identity is not completed: {code}")
        completion = _ORIGINAL_LOAD_JSON(repo_root / completion_file)
        repair_file = _repair_reference_from_completion(completion, code)
        repair = _ORIGINAL_LOAD_JSON(repo_root / repair_file)
        repair_company = repair.get("company")
        if not isinstance(repair_company, dict) or str(repair_company.get("code")) != code:
            raise SystemExit(f"legacy resolved repair company mismatch for {code}")

        override_file = completion.get("sourceIdentityOverride")
        if isinstance(override_file, str) and override_file:
            override = _ORIGINAL_LOAD_JSON(repo_root / override_file)
            override_company = override.get("company")
            if not isinstance(override_company, dict) or str(override_company.get("code")) != code:
                raise SystemExit(f"legacy resolved override company mismatch for {code}")
            if repair.get("independentReviewCompletionBlocked") is not False:
                raise SystemExit(f"legacy resolved repair remains blocked: {code}")
            base.assert_no_forbidden_true(override, f"legacyResolvedOverride[{code}]")
            base.assert_no_forbidden_true(repair, f"legacyResolvedRepair[{code}]")
            normalized = dict(record)
            normalized["overrideFile"] = override_file
            normalized["repairFile"] = repair_file
            normalized_records.append(normalized)
        else:
            # Corrected/re-canonicalized sources such as 421A have an explicit
            # source resolution but no override artifact. Validate that exact
            # resolution here rather than pretending the repair is an override.
            _validate_resolution_without_override(completion, repair, code)
            # The v1 base status schema requires overrideFile for every resolved
            # record, so this already-validated legacy non-override record is
            # omitted only from the in-memory v1 view passed to that validator.
        changed = True

    if not changed:
        return _ORIGINAL_VALIDATE_STATUS(repo_root, status_path)

    normalized_status = dict(status)
    normalized_status["resolvedSourceIdentityRecords"] = normalized_records

    def compatible_load_json(path: Path) -> dict[str, Any]:
        if path == status_path:
            return normalized_status
        return _ORIGINAL_LOAD_JSON(path)

    original_loader = base.load_json
    try:
        base.load_json = compatible_load_json
        return _ORIGINAL_VALIDATE_STATUS(repo_root, status_path)
    finally:
        base.load_json = original_loader


def main() -> None:
    base.validate_collection_identity = strict_collection_identity_compat
    base.validate_completion = strict_completion_status_compat
    base.validate_status = strict_status_compat
    base.main()


if __name__ == "__main__":
    main()
