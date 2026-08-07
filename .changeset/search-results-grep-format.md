---
"@nanocollective/nanocoder": patch
---

`search_file_contents` now formats results grep-style (`file:line:content`, one line per match) instead of spreading each match across three lines with a blank separator. Matches with `contextLines` still show the full multi-line context block, now with a `-` header separator matching grep's convention.
