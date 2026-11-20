---
"@nanocollective/nanocoder": patch
---

A null or nameless entry in `providers` no longer crashes startup: invalid entries are skipped with a clear message naming the entry and its config file, and the valid providers still load.
