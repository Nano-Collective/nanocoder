---
"@nanocollective/nanocoder": patch
---

Fixed info, success, warning and error messages rendering their continuation lines one column to the right. Ink wraps text with `trim: false`, so when a word-boundary space fell exactly on the wrap column it became the first character of the next line - visible on `/commit` output at certain terminal widths. Messages are now pre-wrapped, and indentation the caller wrote itself is preserved.
