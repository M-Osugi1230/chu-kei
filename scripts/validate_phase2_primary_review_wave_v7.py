#!/usr/bin/env python3
"""Primary-review wave validator with pending-marker compatibility.

Later review-state overlays use ``remainingVisualFigureReview`` to mean that the
visual-figure review is still outstanding, while the older v2 validator expects
``visualFigureReview`` in ``pendingChecks``. Both represent the same pending
review gate. This wrapper normalizes only an in-memory validation copy and leaves
repository evidence unchanged.
"""

from __future__ import annotations

import copy
from typing import Any

import validate_phase2_primary_review_wave_v5 as v5
import validate_phase2_primary_review_wave_v6 as v6

LEGACY_PENDING_MARKER = "visualFigureReview"
CURRENT_PENDING_MARKER = "remainingVisualFigureReview"


def normalize_pending_list(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    normalized = copy.deepcopy(value)
    if CURRENT_PENDING_MARKER in normalized and LEGACY_PENDING_MARKER not in normalized:
        normalized.append(LEGACY_PENDING_MARKER)
    return normalized


def normalize_overlay(overlay: dict[str, Any] | None) -> dict[str, Any] | None:
    if overlay is None:
        return None
    normalized = copy.deepcopy(overlay)
    if "pendingChecksForAll" in normalized:
        normalized["pendingChecksForAll"] = normalize_pending_list(
            normalized.get("pendingChecksForAll")
        )
    completions = normalized.get("companyCompletions")
    if isinstance(completions, list):
        for completion in completions:
            if isinstance(completion, dict) and "pendingChecks" in completion:
                completion["pendingChecks"] = normalize_pending_list(
                    completion.get("pendingChecks")
                )
    return normalized


def materialize_wave_overlay(
    wave: dict[str, Any], overlay: dict[str, Any] | None
) -> dict[str, Any]:
    return v6.materialize_wave_overlay(wave, normalize_overlay(overlay))


v5.materialize_wave_overlay = materialize_wave_overlay

if __name__ == "__main__":
    v5.main()
