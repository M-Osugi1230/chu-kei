# Structured Data Scaling v1

Chu-kei reached 200 structured companies while keeping the compressed source-of-truth bundle below the former 128 KiB frontend limit. The frontend now separates list/search metadata from detail evidence so the initial page remains fast while structured coverage can continue beyond 200 companies.

## Goals

- Keep the first-load company index compact and searchable.
- Load detailed strategy, metrics, warnings, and page evidence only when a company detail is opened.
- Preserve the existing source-of-truth, review ledgers, quality scores, and deterministic generation flow.
- Maintain static hosting without introducing a backend dependency.
- Verify lazy loading, error recovery, mobile interaction, comparison, and cached repeat opens in real browsers.

## Generated layout

- `company-index.json.gz`: code, name, market, industry, stage, compact quality, themes, short summary, flags, metric count, detail routing, and progress data.
- `details-NNN.json.gz`: strategy metrics, capital allocation, return policy, highlights, warnings, evidence references, official source, and full quality data for 20 companies.
- `manifest.json`: source bundle hash, file hashes, byte sizes, company counts, and detail-shard routing.
- The canonical bundle remains the source of truth for quality, governance, and future regeneration.

## Measured result at 200 structured companies

- Canonical compressed source bundle: 127,915 bytes.
- Frontend index: 48,147 bytes.
- Frontend manifest: 5,431 bytes.
- Initial frontend data: 53,578 bytes against a 98,304-byte budget.
- Initial data reduction versus the previous monolithic fetch: 74,337 bytes, or approximately 58%.
- Detail shards: 29.
- Largest detail shard: 9,806 bytes against a 32,768-byte budget.
- Total detail bytes are not downloaded on first load; a shard is fetched only when a contained company is opened or compared.

## Runtime behavior

- All 570 companies remain searchable from the initial index.
- Opening a company fetches one integrity-checked gzip detail shard.
- Reopening a company in the same session reuses the in-memory shard promise and detail cache.
- Comparing companies fetches only the shards required for the selected companies.
- A failed detail request keeps the dialog usable and offers an in-place retry.
- Deep links restore the workspace first and then lazy-load the requested company detail.

## Migration rule

The monolithic bundle remains canonical. Frontend shards are deterministic derived artifacts and must match the canonical source SHA-256, company count, and progress count. No company is promoted, removed, or re-scored during this storage migration.
