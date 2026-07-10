# Source link audit policy

## Scope

- company IR pages
- mid-term plan PDFs
- progress and revision documents
- exchange reference pages

## States

- reachable
- redirected
- temporarily unavailable
- blocked by automated access restrictions
- not found
- requires manual verification

## Rules

- a network failure is not automatically treated as a broken source;
- redirects must be recorded and reviewed before replacing the canonical URL;
- source removal creates an improvement task and does not silently delete evidence;
- repeated failures become a blocking issue for production-quality data only after manual verification;
- checks must be rate-limited and identify Chu-kei appropriately where practical.
