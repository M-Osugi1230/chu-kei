#!/usr/bin/env python3
"""Primary-review wave validator for Wave23's compact audit representation.

Wave23 intentionally omits per-company ``requiredChecks`` and records the checks
actually completed once in its append-only overlay as ``completedChecksForAll``.
For validation only, this wrapper copies that audited check set into missing
``requiredChecks`` fields for companies covered by the overlay, then delegates to
v8. Existing requiredChecks are never overwritten and repository evidence is not
mutated.
"""

from __future__ import annotations

import copy
from typing import Any

import validate_phase2_primary_review_wave_v5 as v5
import validate_phase2_primary_review_wave_v8 as v8


def materialize_wave_overlay(
    wave: dict[str, Any], overlay: dict[str, Any] | None
) -> dict[str, Any]:
    normalized_wave = copy.deepcopy(wave)
    if overlay is not None:
        completions = overlay.get("companyCompletions")
        completion_codes = {
            str(item.get("code", ""))
            for item in completions
            if isinstance(item, dict)
        } if isinstance(completions, list) else set()
        audited_checks = overlay.get("completedChecksForAll")
        companies = normalized_wave.get("companies")
        if isinstance(companies, list):
            for company in companies:
                if not isinstance(company, dict):
                    continue
                code = str(company.get("code", ""))
                if code not in completion_codes or company.get("requiredChecks") is not None:
                    continue
                if not isinstance(audited_checks, list) or len(audited_checks) < 4:
                    raise SystemExit(
                        f"overlay lacks audited check set for requiredChecks hydration: {code}"
                    )
                if "fieldLevelEvidence" not in audited_checks:
                    raise SystemExit(
                        f"overlay audited check set lacks fieldLevelEvidence: {code}"
                    )
                company["requiredChecks"] = copy.deepcopy(audited_checks)
    return v8.materialize_wave_overlay(normalized_wave, overlay)


v5.materialize_wave_overlay = materialize_wave_overlay

if __name__ == "__main__":
    v5.main()
