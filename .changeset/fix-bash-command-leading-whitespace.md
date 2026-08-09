---
"@nanocollective/nanocoder": patch
---

Fixed bash commands entered with `!` keeping the whitespace that followed the prefix, so `! git status` now runs `git status` instead of ` git status`.
