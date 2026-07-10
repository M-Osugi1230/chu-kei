# Accessibility baseline

## Mandatory for every release

- one visible keyboard focus treatment;
- skip navigation to main content;
- labelled inputs and controls;
- non-empty accessible names for buttons;
- table captions and scoped column headers;
- status regions for dynamic result counts;
- no duplicate DOM IDs;
- sufficient mobile reflow without page-level horizontal overflow;
- comparison tables may scroll within their own region;
- keyboard access to search, filter, company details, and comparison.

## QA

Static checks are necessary but not sufficient. A hosted release also requires keyboard walkthrough, screen-reader spot checks, desktop browser QA, and 390px mobile browser QA.
