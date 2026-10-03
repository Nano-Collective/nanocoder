---
"@nanocollective/nanocoder": patch
---

Fixed /expand list rows: multi-line command arguments are collapsed to a single line, cut to the width the terminal leaves for the row, and the id column is padded so tool names stay aligned past result 9. Thanks to @theluckystrike. Closes #1534.
