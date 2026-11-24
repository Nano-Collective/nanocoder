---
"@nanocollective/nanocoder": patch
---

`string_replace` and `diff_edit` now count overlapping matches when checking that a search string is unique. A needle such as `aa` in `aaa`, or `x\nx` in three repeated lines, previously looked unique and the first match was replaced silently; both tools now reject it as ambiguous until more context is supplied. Closes #2236.
