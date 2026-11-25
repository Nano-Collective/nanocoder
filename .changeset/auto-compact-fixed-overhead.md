---
"@nanocollective/nanocoder": patch
---

Skip auto-compaction and show a one-time notice when the system prompt and tool definitions alone already exceed the context limit, or exceed the compaction threshold while total usage still fits in the window (still compacting once total usage reaches the context limit).
