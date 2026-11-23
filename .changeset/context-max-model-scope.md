---
"@nanocollective/nanocoder": patch
---

Scope `/context-max` session overrides to the specific provider and model they were set for, preventing stale manual limits from surviving `/model` switches, `/clear`, or `/resume`. Thanks to @dhruvil-codes. Closes #2360.
