---
'@nanocollective/nanocoder': patch
---

Bound lifecycle-hook context passed through the environment. Vetoing hooks now block actions when their input is truncated or the hook process cannot start, instead of silently allowing the action. Closes #2011.
