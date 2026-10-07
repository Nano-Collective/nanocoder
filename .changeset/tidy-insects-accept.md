---
'@nanocollective/nanocoder': patch
---

Reject malformed proposal indexes such as `1oops` and `1.5` in `/memory accept` instead of silently saving proposal 1. Closes #1589.
