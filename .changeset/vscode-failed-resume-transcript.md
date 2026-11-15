---
"@nanocollective/nanocoder": patch
---

Fix the VS Code extension clearing the chat transcript when resuming an invalid or stale ACP session. Session resumption updates and metadata are now buffered during resumption so that if resumption fails, existing conversation messages remain preserved instead of being cleared. Closes #1718.
