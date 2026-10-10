---
'@nanocollective/nanocoder': patch
---

Reject malformed proposal indexes such as `1oops`, `1.5`, `1.`, `+1`, and `1e2` in `/memory accept` instead of silently saving proposal 1. Show the invalid input and valid range when rejecting it. Closes #1589.
