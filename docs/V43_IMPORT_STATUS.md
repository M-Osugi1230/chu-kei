# v43 import status

## Ready

- checksum-pinned v42 source import
- deterministic v42-to-v43 conversion
- quality profiles for all companies
- date-semantics migration
- Coverage beta scoring exclusion
- generated-site strict quality gate
- Netlify `site/` publish configuration
- release, quality, accessibility, security, and monetization guardrails

## Pending binary source

Add the exact source package at:

`imports/v42/chukei_570_company_operations_v42.zip`

Required SHA-256:

`5e04ebc528b844ff82f785a219f7953364a226ef1b782eefbf4000f327a6a62a`

The workflow then generates `site/`, runs the strict v43 quality gate, and commits only a passing result.

## After generation

- review the generated diff;
- confirm the workflow artifact;
- deploy a Netlify preview;
- rerun hosted desktop and mobile browser QA;
- merge only after the hosted release gate passes.
