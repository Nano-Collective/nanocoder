---
"@nanocollective/nanocoder": patch
---

Fixed pasting into text fields other than the main composer. Bracketed-paste payloads are lifted off stdin and re-emitted on an event bus that only the main prompt subscribed to, so a paste into a wizard field, settings panel, or review prompt was silently discarded. Every text field now receives pastes the same way the composer does. Closes #1456.
