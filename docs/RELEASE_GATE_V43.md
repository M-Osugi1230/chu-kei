# v43 release gate

A v43 build may be merged or deployed only when all mandatory conditions pass.

## Data

- 570 companies
- unique four-character security codes
- 30 core companies
- 70 detailed-extracted beta companies
- 100 source-indexed beta companies
- 370 Coverage beta companies
- 200 source-confirmed-or-better companies
- 100 structured companies
- 149 progress rows with no duplicates or orphans

## Semantics

- no legacy ambiguous `date` field
- `planPublishedDate` and `lastVerifiedDate` are separated
- every company has a `qualityProfile`
- Coverage beta is excluded from scoring
- Coverage beta has no inferred strategic analysis

## UI and safety

- quality tier is visible
- publication date and verification date are separately labelled
- investment-advice disclaimer is visible
- external blank-target links include `noopener`
- keyboard focus is visible
- skip navigation is present

## Deployment

- strict quality workflow passes
- ZIP and generated-file checksums pass
- hosted desktop and mobile browser QA is completed before public release
