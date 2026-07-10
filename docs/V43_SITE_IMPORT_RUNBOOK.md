# v43 site import runbook

## Source of truth

The original source is `chukei_570_company_operations_v42.zip` with SHA-256:

`5e04ebc528b844ff82f785a219f7953364a226ef1b782eefbf4000f327a6a62a`

## Import sequence

1. Place the ZIP at `imports/v42/chukei_570_company_operations_v42.zip`.
2. GitHub Actions verifies the checksum.
3. The nested public v42 package is extracted.
4. Data is converted to the v43 model.
5. The generated site is written to `site/`.
6. `npm run quality:v43` runs in strict mode.
7. Only a successful build is committed to the branch.

## v43 transformations

- Separate `planPublishedDate` and `lastVerifiedDate`.
- Add `qualityProfile` to all 570 companies.
- Keep the 30 / 70 / 100 / 370 quality tiers explicit.
- Disable scoring for Coverage beta companies.
- Remove unverified analysis structures from source-indexed and Coverage beta tiers.
- Reduce duplicated placeholder data.
- Display publication date and verification date separately.
- Improve external-link safety, table semantics, focus state, and skip navigation.

## Release gate

The migration is complete only when:

- all 570 security codes are unique;
- quality tiers equal 30 / 70 / 100 / 370;
- all legacy ambiguous `date` fields are removed;
- all companies have a quality profile;
- Coverage beta is not scored;
- 149 progress rows have no duplicate or orphan rows;
- the strict quality workflow passes;
- generated site files are committed under `site/`.
