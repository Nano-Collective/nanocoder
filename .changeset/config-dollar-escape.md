---
"@nanocollective/nanocoder": patch
---

Support `$$` as an escape for a literal `$` during configuration environment variable substitution, so values like `pa$$WORD` or `sk-$$ECRET-key` are no longer silently emptied. Note: An existing literal `$$` in a config will now be evaluated as a single `$`. Closes #1980.

