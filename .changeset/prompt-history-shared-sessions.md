---
"@nanocollective/nanocoder": patch
---

Two Nanocoder sessions in the same project no longer erase each other's prompt history. Each session wrote its own in-memory list over the shared history file, so the last one to save won and the other session's prompts were lost. A save now merges this session's new prompts into what is on disk. Temp files left behind by a session that died mid-save are cleaned up on the next start.
