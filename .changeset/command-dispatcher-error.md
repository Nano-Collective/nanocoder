---
"@nanocollective/nanocoder": patch
---

A slash command whose handler throws now reports `/<cmd> failed: <message>` in the chat instead of rejecting `dispatchSlashCommand`. The rejection reached the process-level `unhandledRejection` handler, which shut the session down with exit code 1 for what was an ordinary command bug. The turn still completes after the message is rendered, and the spinner is still released. Closes #2200.
