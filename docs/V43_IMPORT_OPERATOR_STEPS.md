# v43 import operator steps

1. Open branch `feat/v43-site-import-safe` on GitHub.
2. Open directory `imports/v42/`.
3. Choose **Add file → Upload files**.
4. Upload the original v42 operations package.
5. Rename it exactly to `chukei_570_company_operations_v42.zip` before committing if necessary.
6. Commit directly to `feat/v43-site-import-safe`.
7. Confirm the workflow **Import v42 package as v43 site** starts.
8. Do not merge while the workflow or hosted browser QA is pending.

The workflow rejects any file whose SHA-256 does not match the pinned source checksum.
