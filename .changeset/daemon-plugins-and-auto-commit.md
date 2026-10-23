---
"@nanocollective/nanocoder": patch
---

Daemon-triggered runs now load the project plugins, as `--plain` does after its trust check, and use the daemon model to write `autoCommit` messages instead of always falling back to the generic message.
