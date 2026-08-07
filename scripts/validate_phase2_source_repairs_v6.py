#!/usr/bin/env python3
"""Source-repair validator for hash-pending primary reviews not in current-status.

current-status-v1.json is a hybrid historical ledger; some source-repair records
have a later human-complete primary-review artifact while their source binary hash
is still unresolved and therefore they intentionally remain excluded from
independent-review completion. v5 already validates the explicit current repair
state where ``primaryReviewComplete`` is true. This layer only recognizes older
repair records that still say false but have a later completed primary-review
artifact.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import validate_phase2_source_repairs_v4 as v4
import validate_phase2_source_repairs_v5 as v5

legacy = v5.legacy
_original_validate_hash_pending = v4.validate_primary_review_hash_pending


def is_hash_pending_primary_supersession(
    repair: dict[str, Any],
    code: str,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> bool:
    if repair.get("schemaVersion") != legacy.LEGACY_SCHEMA:
        return False
    # Current repair records that already declare primary-review completion have
    # their own strict v2 validator. This compatibility path is only for older
    # historical repair files whose booleans were never rewritten.
    if repair.get("primaryReviewComplete") is not False:
        return False
    if v5.v2.load_completion(repo_root, code) is not None:
        return False
    if repair.get("independentReviewReady") is not False:
        return False
    current = repair.get("currentOfficialDocument")
    if not isinstance(current, dict):
        return False
    if current.get("pdfSha256") is not None:
        return False
    if not isinstance(current.get("pageCount"), int) or current.get("pageCount", 0) <= 0:
        return False
    primary_path = repo_root / f"operations/quality-rebase/phase2/reviews/{code}-primary-review-v1.json"
    if not primary_path.exists():
        return False
    primary = legacy.load_json(primary_path)
    review = primary.get("review")
    if not isinstance(review, dict):
        return False
    if not str(review.get("status", "")).startswith("primary_review_complete"):
        return False
    source = primary.get("source")
    if not isinstance(source, dict) or source.get("pdfSha256") is not None:
        return False
    return review.get("independentReviewReady") is False


def validate_hash_pending_with_hybrid_ledger(
    repair: dict[str, Any],
    repair_path: Path,
    repo_root: Path,
    completed_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    code = legacy.company_code(repair, repair_path)
    augmented = dict(completed_records)
    augmented.setdefault(
        code,
        {
            "reviewFile": (
                f"operations/quality-rebase/phase2/reviews/{code}-primary-review-v1.json"
            )
        },
    )
    result = _original_validate_hash_pending(
        repair, repair_path, repo_root, augmented
    )
    return {
        **result,
        "ledgerState": (
            "current_status_recorded"
            if code in completed_records
            else "effective_status_source_mapping_pending"
        ),
    }


v5.is_hash_pending_primary_supersession = is_hash_pending_primary_supersession
v5.v4.validate_primary_review_hash_pending = validate_hash_pending_with_hybrid_ledger

if __name__ == "__main__":
    v5.main()
