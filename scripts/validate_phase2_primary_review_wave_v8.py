#!/usr/bin/env python3
"""Primary-review wave validator for audited pre-visual historical states.

``primary_review_complete_existing_review_audited`` is an intermediate historical
wave status used when an existing primary-review artifact has been audited but its
visual-figure review is still pending. When an append-only visual-pending overlay
exists for that company, normalize only the in-memory validation copy to an
assigned state so v7 can apply the overlay. The repository record itself is not
rewritten and the company is never promoted to independent-review-ready by this
compatibility layer.
"""

from __future__ import annotations

import copy
from typing import Any

import validate_phase2_primary_review_wave_v5 as v5
import validate_phase2_primary_review_wave_v7 as v7

AUDITED_PRE_VISUAL_STATUS = "primary_review_complete_existing_review_audited"
VALIDATION_ASSIGNED_STATUS = "primary_review_assigned"


def materialize_wave_overlay(
    wave: dict[str, Any], overlay: dict[str, Any] | None
) -> dict[str, Any]:
    normalized_wave = copy.deepcopy(wave)
    if overlay is not None:
        completions = overlay.get("companyCompletions")
        overlay_codes = {
            str(item.get("code", ""))
            for item in completions
            if isinstance(item, dict)
        } if isinstance(completions, list) else set()
        companies = normalized_wave.get("companies")
        if isinstance(companies, list):
            for company in companies:
                if not isinstance(company, dict):
                    continue
                code = str(company.get("code", ""))
                if (
                    code in overlay_codes
                    and company.get("status") == AUDITED_PRE_VISUAL_STATUS
                ):
                    company["status"] = VALIDATION_ASSIGNED_STATUS
    return v7.materialize_wave_overlay(normalized_wave, overlay)


v5.materialize_wave_overlay = materialize_wave_overlay

if __name__ == "__main__":
    v5.main()
