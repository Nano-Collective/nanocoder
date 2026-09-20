---
"@nanocollective/nanocoder": patch
---

Fixed subagent tool results that return structured data without `llmContent` so the complete output is preserved for the model instead of being passed as `undefined`. Closes #1033.
