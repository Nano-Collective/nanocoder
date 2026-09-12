---
"@nanocollective/nanocoder": patch
---

Fix a race in the composer where typing or pressing Enter immediately after a paste could silently drop the pasted content (or no-op the Enter), by reconciling stale input state against the latest committed value instead of the value captured at the last render.
