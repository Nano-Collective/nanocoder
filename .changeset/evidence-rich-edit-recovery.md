---
'@nanocollective/nanocoder': minor
---

Added bounded recovery evidence for failed `string_replace` and `diff_edit` searches, including likely target ranges, exact current text, and whitespace or code-difference notes. Ambiguous targets and oversized evidence prompt a focused read before retrying. Failed edits remain exact-match-only and leave files unchanged.
