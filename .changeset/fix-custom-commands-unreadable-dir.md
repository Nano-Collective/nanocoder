---
"@nanocollective/nanocoder": patch
---

Fixed an issue in `CustomCommandLoader` where encountering an unreadable subdirectory or inaccessible file in custom command directories aborted the entire scan. `scanDirectory` and `loadResources` now catch filesystem permission and inspection errors, log a warning, and continue scanning remaining commands.
