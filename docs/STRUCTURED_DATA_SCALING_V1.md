# Structured Data Scaling v1

Chu-kei reached 200 structured companies while keeping the compressed source-of-truth bundle below the 128 KiB absolute limit. The next phase separates list/search metadata from detail evidence so the initial page remains fast while structured coverage can continue beyond 200 companies.

## Goals

- Keep the first-load company index compact and searchable.
- Load detailed strategy, metrics, warnings, and page evidence only when a company detail is opened.
- Preserve the existing source-of-truth, review ledgers, quality scores, and deterministic generation flow.
- Maintain offline-friendly static hosting without introducing a backend dependency.
- Add browser tests for lazy loading, error recovery, mobile interaction, and cached repeat opens.

## Target layout

- `company-index`: code, name, market, industry, stage, quality, themes, short summary.
- `company-details`: strategy metrics, capital allocation, return policy, highlights, warnings, evidence references, flags.
- `progress`: plan-progress observations kept separately from company master data.
- `manifest`: hashes, byte budgets, schema versions, and detail-shard routing.

## Migration rule

The current monolithic bundle remains the canonical migration input until the index/detail split passes data-contract, browser, accessibility, mobile, performance, and deployment gates. No company is promoted or removed during the storage migration.
