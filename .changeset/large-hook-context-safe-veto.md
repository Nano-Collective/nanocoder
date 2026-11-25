---
'@nanocollective/nanocoder': patch
---

Bound lifecycle-hook context to platform environment limits while preserving tool-argument keys and JSON shape. Vetoing hooks receive a truncation flag and decide how to handle incomplete context; an action is still blocked if a vetoing hook cannot start. Closes #2011.
