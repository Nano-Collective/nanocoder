---
"@nanocollective/nanocoder": patch
---

Fix chunked arrow+Enter input in `StyledSelectInput` so keys arriving in the same stdin chunk (such as Down followed by Enter on tool approval and folder trust prompts) select the updated item instead of the stale default option.
