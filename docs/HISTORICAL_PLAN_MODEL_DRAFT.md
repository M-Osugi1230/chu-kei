# Historical plan model draft

Historical comparison is a long-term differentiator and should be supported by the data model before the UI is built.

## Plan identity

- `planId`
- `companyCode`
- `planName`
- `planStartFiscalYear`
- `planEndFiscalYear`
- `planPublishedDate`
- `supersedesPlanId`
- `sourceId`

## Versioned facts

- strategies
- business portfolio
- financial targets
- investment allocation
- M&A policy
- overseas policy
- human-capital policy
- DX policy
- shareholder-return policy
- risks and assumptions

## Change record

- `changeId`
- `companyCode`
- `fromPlanId`
- `toPlanId`
- `field`
- `changeType`: added / removed / increased / decreased / delayed / accelerated / reframed
- `beforeValue`
- `afterValue`
- `sourceEvidence`
- `reviewStatus`

AI may propose a change record, but a human reviewer must verify the meaning before publication.
