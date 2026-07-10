# v43 import acceptance criteria

The import PR is ready to merge only after all items are complete.

- [ ] Exact v42 operations ZIP is committed to the import path.
- [ ] Source package SHA-256 matches the pinned value.
- [ ] GitHub Actions generates `site/` successfully.
- [ ] Strict v43 quality gate passes.
- [ ] Generated `site/` diff is reviewed.
- [ ] Netlify deploy preview publishes from `site/`.
- [ ] Desktop browser QA passes.
- [ ] 390px mobile browser QA passes.
- [ ] Console and page errors are zero.
- [ ] Publication and verification dates are visibly separated.
- [ ] Coverage beta is marked as exploration-only and scoring-ineligible.
- [ ] Hosted accessibility spot checks pass.
