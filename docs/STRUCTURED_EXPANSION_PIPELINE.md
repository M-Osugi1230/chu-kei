# Structured Expansion Pipeline

## Purpose

Expand Chu-kei's structured company coverage without weakening official-source evidence, review governance, browser behavior, or performance budgets.

## Normal flow

1. Collect official IR links from the company IR page.
2. Rank links before downloading documents.
3. Evaluate only the top three official PDFs per company in memory.
4. Retain compact evidence JSON, not PDF binaries.
5. Review the selected facts and write one batch config JSON.
6. Generate deterministic company patches, governance records, and Playwright E2E from the config.
7. Apply patches only when the current source-of-truth record exactly matches `expectedBefore`.
8. Rebuild quality scores and normalize the bundle.
9. Run data, evidence, accessibility, mobile, performance, and deployment gates.

## Commands

```bash
python scripts/rank_official_ir_candidates_v2.py \
  --links-report artifacts/links/report.json \
  --output artifacts/ranked-official-evidence.json \
  --max-per-company 3

STRUCTURED_EXPANSION_CONFIG=operations/patches/<batch>-config.json \
  node scripts/generate_structured_expansion_batch_v2.mjs

while IFS= read -r patch; do
  [ -n "$patch" ] || continue
  COMPANY_PATCH="$patch" node scripts/apply_company_data_patch_v1.mjs
done < operations/patches/<batch>-patch-list.txt

GOVERNANCE_LEDGER_BATCH=operations/patches/<batch>-ledger.json \
  node scripts/apply_governance_ledger_batch_v1.mjs

node scripts/rebuild_quality_scores_v2.mjs
node scripts/normalize_bundle_contract_v1.mjs
npm run quality:v43
npm run quality:local
```

## Safety rules

- Official company sources only.
- Do not infer or fill values that are not disclosed.
- Separate actuals, forecasts, medium-term targets, and long-term aspirations.
- Define company-specific metrics such as ARR, EBITDA, GMV, and adjusted profit.
- Require publication date, period, units, and page-specific evidence.
- Keep reviews in `in_review`; never auto-promote to production.
- Abort on any source-of-truth precondition mismatch.
- Do not increase quality debt or missing page evidence.
- Keep the compressed bundle under the dynamic budget and the 128 KiB absolute limit.

## Efficiency change

The previous discovery workflow could download up to 18 PDFs per company and retain hundreds of megabytes of artifacts. The normal flow now evaluates at most three ranked official PDFs per company in memory and retains only compact evidence summaries. Full browser discovery remains a manual fallback for dynamic IR sites that cannot be resolved through the lightweight flow.
