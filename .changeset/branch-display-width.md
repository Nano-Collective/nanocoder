---
"@nanocollective/nanocoder": patch
---

A git branch name containing CJK characters or emoji no longer breaks the welcome screen's location line. The row was budgeted by counting characters, but a wide glyph is one character and two terminal columns, so the line overflowed and split into a branch row with a dangling separator and a stranded path. Path truncation now measures display width, which also stops an emoji being cut in half. Closes #1389.
