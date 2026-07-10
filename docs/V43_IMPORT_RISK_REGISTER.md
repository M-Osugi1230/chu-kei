# v43 import risk register

| Risk | Impact | Control |
|---|---|---|
| Wrong or re-compressed source ZIP | Non-reproducible output | Pinned SHA-256 and hard failure |
| Publication and verification dates mixed | Misleading data | Separate fields, labels, and quality checks |
| Coverage beta appears analyzed | User misunderstanding | Remove inferred structures and disable scoring |
| Generated files differ from local candidate | Release drift | Deterministic importer, checksums, strict CI |
| Static checks pass but browser behavior fails | Broken user experience | Netlify preview and hosted desktop/mobile QA |
| Source links become unavailable | Lost evidence path | Link-audit states and manual verification policy |
| Quality score interpreted as company rating | Product and legal risk | Explicit quality semantics and monetization guardrails |
| Unreviewed AI extraction reaches production | Data error | Human reviewer and separate approval record |
