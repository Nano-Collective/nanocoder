---
'@nanocollective/nanocoder': patch
---

`search_file_contents` now shows what it found. The expanded tool display lists the `file:line` hits under the match count, capped at the same 20 lines as `execute_bash` output with a `… (+N more lines)` note, instead of only the query, flags, and a count. Closes #1290.
