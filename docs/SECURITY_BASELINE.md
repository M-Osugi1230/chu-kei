# Initial security baseline

## Current static site

- publish only `site/`;
- deny framing;
- use `nosniff`;
- use a strict referrer policy;
- add `noopener noreferrer` to external blank-target links;
- do not place secrets in client-side files;
- verify imported package checksums.

## Before accounts or payments

- define authentication and authorization boundaries;
- use a managed identity provider;
- store no passwords directly;
- separate public data from private user data;
- define deletion and retention policies;
- create audit logs for corporate administration;
- conduct dependency, secret, and access reviews;
- prepare incident-response procedures.

## Before API launch

- API keys or OAuth scopes;
- rate limiting;
- tenant isolation;
- usage logs;
- schema versioning;
- data-license enforcement;
- key rotation and revocation.
