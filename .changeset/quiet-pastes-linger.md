---
"@nanocollective/nanocoder": patch
---

Fix a race in the composer where typing, pressing Backspace, or pressing Enter immediately after a paste could silently drop the pasted content or swallow the key. Edits that arrive before the paste is shown are now replayed onto it, and Enter submits what the composer actually holds.
