---
"@nanocollective/nanocoder": patch
---

`search_file_contents` treats a negative `contextLines` as `0`, so it no longer marks the whole file as read. Closes #2378.
