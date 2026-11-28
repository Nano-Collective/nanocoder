---
"@nanocollective/nanocoder": patch
---

`search_file_contents` treats a negative `contextLines` as `0`, so it no longer marks the whole file as read, and rounds a fractional one down instead of failing in ripgrep. Closes #2378.
