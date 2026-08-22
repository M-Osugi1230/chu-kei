#!/usr/bin/env python3
"""Compatibility-safe Phase 2 primary-review ledger gate.

The v1 validator remains the canonical company-level validator. This wrapper adds
one explicit historical compatibility rule: assignments removed by the audited
wave de-duplication pass may still appear in immutable completion overlays from
their original later wave. The de-duplication audit is itself validated before
those historical memberships are admitted.

Aggregate/cumulative counters from older overlay generations are deliberately not
interpreted as wave-local counters. Company-level review artifacts and the
canonical effective-status ledger remain the counting source of truth.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import validate_phase2_primary_review_ledger_v1 as base

DEDUP_SCHEMA = "phase2-wave-assignment-dedup-audit-v1"
_ORIGINAL_LOAD_WAVES = base.load_waves


def load_waves_with_audited_history(phase2: Path) -> dict[int, dict[str, Any]]:
    waves = _ORIGINAL_LOAD_WAVES(phase2)
    audit_path = phase2 / "wave-assignment-dedup-audit-v1.json"
    audit = base.load_json(audit_path)
    if not isinstance(audit, dict) or audit.get("schemaVersion") != DEDUP_SCHEMA:
        base.die(f"{audit_path}: unexpected de-duplication audit schema")

    removed = audit.get("removedFromLaterWaves")
    if not isinstance(removed, list):
        base.die(f"{audit_path}: removedFromLaterWaves must be an array")
    declared_count = audit.get("duplicateCompanyCount")
    if not isinstance(declared_count, int) or declared_count != len(removed):
        base.die(
            f"{audit_path}: duplicateCompanyCount must equal removedFromLaterWaves length"
        )

    seen: set[tuple[int, str]] = set()
    for index, item in enumerate(removed):
        if not isinstance(item, dict):
            base.die(f"{audit_path}: removedFromLaterWaves[{index}] must be an object")
        code = base.code_of(item.get("code"))
        canonical_wave = item.get("canonicalWave")
        removed_wave = item.get("removedDuplicateWave")
        if code is None or not isinstance(canonical_wave, int) or not isinstance(removed_wave, int):
            base.die(f"{audit_path}: invalid de-duplication row at index {index}")
        if canonical_wave == removed_wave:
            base.die(f"{audit_path}: {code} canonical/removed waves must differ")
        if canonical_wave not in waves or removed_wave not in waves:
            base.die(f"{audit_path}: {code} refers to an unknown wave")
        if code not in waves[canonical_wave]["codes"]:
            base.die(
                f"{audit_path}: canonical wave {canonical_wave} no longer contains {code}"
            )
        if code in waves[removed_wave]["codes"]:
            base.die(
                f"{audit_path}: removed duplicate {code} is still assigned to wave {removed_wave}"
            )
        key = (removed_wave, code)
        if key in seen:
            base.die(f"{audit_path}: duplicate audited removal for wave {removed_wave}/{code}")
        seen.add(key)

        # Preserve immutable completion-overlay history without restoring the
        # duplicate to the canonical assignment files.
        waves[removed_wave]["codes"].add(code)

    preservation = audit.get("auditPreservation")
    if not isinstance(preservation, dict):
        base.die(f"{audit_path}: auditPreservation is missing")
    for key in ("reviewFilesDeleted", "sourceEvidenceDeleted", "sourceRepairsDeleted"):
        if preservation.get(key) is not False:
            base.die(f"{audit_path}: auditPreservation.{key} must be false")
    for key in ("automaticApprovalAllowed", "deepVerificationApproved"):
        if preservation.get(key) is not False:
            base.die(f"{audit_path}: auditPreservation.{key} must be false")
    base.require_false_safety(audit, audit_path)
    return waves


def wave_local_numeric_count(payload: dict[str, Any]) -> tuple[int | None, int | None]:
    """Read only counters whose names are unambiguously wave-local.

    Historical overlays also contain cumulative/global fields named
    primaryReviewComplete/remaining. Treating those as local produced false
    failures and, more importantly, mixed two different counting units.
    """

    primary: int | None = None
    remaining: int | None = None
    for container in (
        payload.get("effectiveCounts"),
        payload.get("counts"),
        payload,
    ):
        if not isinstance(container, dict):
            continue
        value = container.get("wavePrimaryReviewComplete")
        if primary is None and isinstance(value, int):
            primary = value
        value = container.get("waveRemaining")
        if remaining is None and isinstance(value, int):
            remaining = value
    return primary, remaining


def main() -> int:
    base.load_waves = load_waves_with_audited_history
    base.latest_numeric_count = wave_local_numeric_count
    return base.main()


if __name__ == "__main__":
    raise SystemExit(main())
