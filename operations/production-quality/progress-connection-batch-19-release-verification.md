# Progress Connection Batch 19 — Release Verification

- Verified company: 4901 FUJIFILM Holdings
- Verified source: official FY2025 results presentation published May 12, 2026
- Connected metrics: 6 rows
- Progress rows after application: 275
- Production-stage companies after promotion: 162
- Five-star companies after promotion: 148
- Automatic fact completion: not used
- Automatic approval: not used
- Promotion selection: explicit company code
- Approval roles: production-quality-review and independent-release-review

## Evidence and metric matching

The official presentation’s VISION2030 progress table places the FY2025 final actuals, FY2026 company forecast, and FY2026 VISION2030 targets in separate columns. The connection uses the confirmed FY2025 actual column and the rightmost VISION2030 target column; the middle company-forecast column is not used as either an actual or a target.

The connected rows are:

- Revenue: JPY 3,357.0 billion actual versus JPY 3,450.0 billion target
- Operating profit: JPY 350.2 billion actual versus JPY 360.0 billion target
- Operating margin: 10.4% actual versus 10.4% target
- Net income attributable to FUJIFILM Holdings: JPY 276.7 billion actual versus JPY 270.0 billion target
- ROE: 7.7% actual versus 8.1% target
- Company-defined ROIC: 5.5% actual versus 5.8% target

Operating margin is already at the target value and attributable net income exceeds the target value. These conditions are preserved as disclosed; the simple progress ratio is not treated as evidence of future durability or attainment probability. ROIC is identified as the company-defined measure and should not be compared mechanically with differently defined ROIC figures.

## Execution and governance

The batch contains an explicit one-company production approval object with automatic selection disabled and two distinct reviewer roles. The approval object was removed after successful one-time application. The progress selector was also removed after use.

The progress runner now discovers numbered `batch-XX-selection.json` files dynamically instead of hard-coding a batch number, while preserving legacy marker compatibility. The generated progress report, promotion report, readiness report, governance ledgers, quality score report, and frontend data agree with the batch contracts.

Data-contract, source-audit, review-governance, quality-debt, browser E2E, accessibility, performance, and deployment gates must pass on a human-authored final head before merge.
