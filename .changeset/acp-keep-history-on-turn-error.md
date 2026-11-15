---
"@nanocollective/nanocoder": patch
---

Fix an ACP prompt losing its history when the model request (or auto-compaction) failed after the first round-trip. The tool calls and results that already ran, and edited files, now stay in the session and on disk instead of only the user message and the error, so timeline checkpoints still point inside the history and the next prompt sees what was done. A batch cut off part way through gets a result for each unanswered call, so the provider does not reject the following prompt.
