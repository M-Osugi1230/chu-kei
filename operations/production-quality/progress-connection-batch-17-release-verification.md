# Progress Connection Batch 17 — Release Verification

- Verified companies: 5711 Mitsubishi Materials, 7735 SCREEN Holdings
- Connected metrics: 5 rows in total
- Progress rows after application: 262
- Production-stage companies after promotion: 159
- Five-star companies after promotion: 145
- Automatic fact completion: not used
- Automatic approval: not used
- Promotion selection: explicit company codes
- Approval roles: production-quality-review and independent-release-review

## Mitsubishi Materials

The FY2028 targets were rechecked against the official Medium-term Management Strategy (FY2026–FY2028), and the baseline was replaced with the official FY2025 final results published on May 13, 2026. The connected values are ROE 5.7% versus 8.0% or more, company-defined ROIC 6.1% versus 7.0% or more, and ordinary profit JPY 97.5 billion versus the reference level of JPY 85.0 billion or more. The ordinary-profit baseline already exceeds the target floor; the displayed ratio must not be interpreted as durability or future attainment probability.

## SCREEN Holdings

The official FY2025 results presentation places the Value Up Further 2026 target and first-year actual in the same progress table. ROIC 24.7% is connected to the 15% or more target, and consolidated dividend payout ratio 30.1% is connected to the 30% or more target. Cumulative sales and through-period operating margin were excluded because their target periods do not match a single-year actual.

## UI and pipeline

Progress metric aliases were added for ordinary profit, operating margin, ROA, ROE, ROIC, overseas revenue ratio, and dividend payout ratio so internal metric keys are not exposed to users. Progress and promotion runners now accept both the legacy run-marker filenames and the new selection filenames; each selection file is removed after successful application, preserving one-time execution and backwards compatibility.

The generated progress report, promotion report, readiness report, governance ledgers, quality score report, and frontend data agree with the batch contracts. Data-contract, source-audit, review-governance, quality-debt, browser E2E, accessibility, performance, and deployment gates must pass before merge.
