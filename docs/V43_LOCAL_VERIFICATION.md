# v43 local rebuild verification

The v42 operations package was rebuilt locally into the v43 quality model before enabling repository import.

## Result

- Release validation: 38 / 38 PASS
- Company total: 570
- Quality tiers: 30 / 70 / 100 / 370
- Progress rows: 149
- Duplicate progress rows: 0
- Orphan progress rows: 0
- Legacy ambiguous `date` fields: 0
- Companies with quality profile: 570
- Coverage beta scoring enabled: 0
- Company JSON combined size: 2,125,009 bytes
- ZIP re-extraction validation: PASS
- ZIP compressed-data integrity: PASS

## Important limitation

This record covers deterministic data, static UI, and archive validation. A new hosted browser QA run must be executed after the generated `site/` is committed and deployed. Previous v43 browser evidence must not be treated as evidence for the rebuilt deployment until that run is complete.
