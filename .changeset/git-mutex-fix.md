---
"@nanocollective/nanocoder": patch
---

Fix parallel git tool operations (like git_add and git_commit) to serialize correctly and avoid index.lock race conditions.
