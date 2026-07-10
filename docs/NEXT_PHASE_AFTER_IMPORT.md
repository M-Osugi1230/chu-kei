# Priorities after v43 site import

## P0: release verification

1. Confirm strict GitHub quality gate.
2. Run hosted desktop browser QA.
3. Run hosted 390px mobile browser QA.
4. Confirm console and page errors are zero.
5. Confirm Netlify preview uses `site/`.

## P1: quality operations

1. Generate the 570-company quality matrix from the repository data.
2. Generate the promotion queue automatically.
3. Add stale-verification detection.
4. Add official-source link reachability checks with rate limiting.
5. Separate blocking errors from non-blocking improvement tasks.

## P2: UX

1. Explain quality score in the company detail view.
2. Improve strategy-first discovery cards.
3. Make comparison availability depend on confirmed data.
4. Add zero-result recovery suggestions.
5. Review screen-reader announcements and keyboard flow.

## P3: production promotion

1. Select detailed beta companies with the smallest evidence gap.
2. Add page-level evidence.
3. Verify numbers, units, periods, and target/actual classification.
4. Require a second reviewer.
5. Promote only companies that pass the complete production gate.
