---
"@nanocollective/nanocoder": patch
---

Skip auto-compaction and show a one-time notice when the system prompt and tool definitions alone already meet or exceed the context limit, or sit between the compaction threshold and the context limit while total usage is still below the midpoint to the limit (compacting once usage passes that midpoint so the next request still has headroom).
