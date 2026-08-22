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
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import validate_phase2_independent_completions as base

_ORIGINAL_VALIDATE_COLLECTION_IDENTITY = base.validate_collection_identity
_ORIGINAL_VALIDATE_COMPLETION = base.validate_completion
_LEGACY_SOURCE_IDENTITY_STATUS = "confirmed_with_override"
_CURRENT_OVERRIDE_STATUS = "confirmed_after_override"


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
        # New-format records use the original strict validator unchanged.
        _ORIGINAL_VALIDATE_COLLECTION_IDENTITY(repo_root, completion, code)
        return

    source = completion.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"source missing for completion {code}")
    # The base validator already checks source field syntax. Repeat the SHA
    # requirement here so this compatibility path can never accept a weak id.
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
        bulk_root = (
            repo_root
            / "operations"
            / "quality-rebase"
            / "phase2"
            / "bulk-collection"
        )
        candidates.extend(sorted(bulk_root.glob(f"**/{code}/collection.json")))

    if not candidates:
        raise SystemExit(f"no canonical collection candidate found for {code}")

    matched: list[Path] = []
    for path in candidates:
        collection = base.load_json(path)
        if collection_matches_source(collection, source, code):
            matched.append(path)

    if not matched:
        raise SystemExit(
            f"completion source identity does not match canonical collection for {code}"
        )

    # If more than one historical collection copy exists, all accepted copies
    # necessarily have the same exact source identity because of the predicate
    # above. We intentionally do not choose a weaker or approximate source.


def strict_completion_status_compat(
    repo_root: Path,
    record: dict[str, Any],
) -> str:
    """Validate the one legacy override spelling without widening base policy."""
    code = str(record.get("code", "")).strip()
    file_value = record.get("file")
    if not code or not isinstance(file_value, str) or not file_value:
        # Preserve the base validator's canonical error handling for malformed
        # aggregate records.
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

    # Legacy status is valid for exactly one historical source-identity check.
    # Reject any attempt to use it on another check or more than once.
    if len(legacy_checks) != 1 or legacy_checks[0].get("id") != "source_identity":
        raise SystemExit(f"legacy override status is only valid for source_identity / {code}")
    override_file = completion.get("sourceIdentityOverride")
    if not isinstance(override_file, str) or not override_file:
        raise SystemExit(f"legacy source_identity status lacks sourceIdentityOverride for {code}")

    # Validate the override before temporarily exposing the legacy spelling to
    # the base status check. This uses the unchanged strict source fields,
    # company identity, canonical source matching, and forbidden-flag checks.
    source = completion.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"source missing for completion {code}")
    base.validate_source(source, f"completion[{code}].source")
    base.validate_override(repo_root, completion, code)

    # The base validator has a module-level status set. Widen it only for this
    # single synchronous validation call, after proving no other check uses the
    # legacy value, then restore it unconditionally. This avoids changing the
    # policy for current/new records.
    original_statuses = base.CONFIRMED_CHECK_STATUSES
    try:
        base.CONFIRMED_CHECK_STATUSES = original_statuses | {_LEGACY_SOURCE_IDENTITY_STATUS}
        return _ORIGINAL_VALIDATE_COMPLETION(repo_root, record)
    finally:
        base.CONFIRMED_CHECK_STATUSES = original_statuses


def main() -> None:
    base.validate_collection_identity = strict_collection_identity_compat
    base.validate_completion = strict_completion_status_compat
    base.main()


if __name__ == "__main__":
    main()
