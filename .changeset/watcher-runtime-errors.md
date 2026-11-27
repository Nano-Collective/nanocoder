---
"@nanocollective/nanocoder": patch
---

Log every file watcher error after startup instead of silently swallowing the first and crashing on the next. Startup errors still reject initialization and close the watcher.
