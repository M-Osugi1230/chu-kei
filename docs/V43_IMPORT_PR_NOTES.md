# v43 import PR review notes

This PR intentionally separates import infrastructure from the binary source and generated site.

Review order:

1. importer and checksum enforcement;
2. generated-site workflow permissions and commit behavior;
3. v43 data transformations;
4. quality, release, accessibility, security, and monetization policies;
5. binary source upload;
6. generated site diff and strict quality result;
7. hosted browser QA.

The PR should remain draft until steps 5–7 are complete.
