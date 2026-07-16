# Progress Connection Batch 18 — Release Verification

- Verified companies: 5201 AGC, 1928 Sekisui House
- Connected metrics: 7 rows in total
- Progress rows after application: 269
- Production-stage companies after promotion: 161
- Five-star companies after promotion: 147
- Automatic fact completion: not used
- Automatic approval: not used
- Promotion selection: explicit company codes
- Approval roles: production-quality-review and independent-release-review

## AGC

The official AGC plus-2026 page presents FY2025 actuals, FY2026 forecasts, and FY2030 targets in the same financial-progress image. Only the confirmed FY2025 actuals and FY2030 target floors were connected: operating profit JPY 127.5 billion versus JPY 300.0 billion or more, strategic-business operating profit JPY 58.7 billion versus JPY 190.0 billion or more, and ROE 4.7% versus 10% or more. The FY2026 forecast column was intentionally excluded from the actual baseline.

Because the source is an official Web progress image rather than a paginated PDF, the progress-connection validator now accepts a named official Web page or Web image as evidence while continuing to require an HTTPS official source, publication date, verification date, metric definition, unit, fiscal year, and explicit evidence label.

## Sekisui House

The official Seventh Medium-Term Management Plan contains FY2025 final results on PDF p.3 and FY2028 targets on PDF p.10. Revenue JPY 4,197.9 billion is connected to JPY 5,026.0 billion, operating profit JPY 341.4 billion to JPY 450.0 billion, ordinary profit JPY 327.8 billion to JPY 434.0 billion, and profit attributable to owners of parent JPY 232.0 billion to JPY 300.0 billion. ROE was excluded because the target is described as the high-12% range rather than a single strict value.

## Governance and one-time execution

The two company codes were embedded in the existing batch as an explicit production-approval object because a separate new promotion file could not be created through the connected write path. The promotion runner validates the same production-promotion schema, explicit approval, prohibition of automatic selection, two distinct reviewer roles, machine-readiness queue, and exact target core count. After successful application, the embedded approval object is removed from the batch file, preserving one-time execution.

The progress report, promotion report, readiness report, governance ledgers, quality-score report, and frontend data agree with the batch contracts. Data-contract, source-audit, review-governance, quality-debt, browser E2E, accessibility, performance, and deployment gates must pass before merge.
