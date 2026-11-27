---
"@nanocollective/nanocoder": patch
---

Fix `diff_edit` accepting a multi-block edit during validation when an earlier replacement makes a later SEARCH block missing or ambiguous. Validation now dry-runs the same ordered replacements as execution and reports the failing block before approval, without changing the file. Closes #2235.
