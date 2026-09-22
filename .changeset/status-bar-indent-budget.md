---
"@nanocollective/nanocoder": patch
---

The status bar no longer truncates mid-word on an 80-column terminal. It budgeted its segments against the full terminal width while rendering inside a wrapper indented by three columns, so the row overflowed by exactly that much and the terminal cut it ("auto-accept mode o"). The indent is now part of the budget, so a segment is dropped or a name is ellipsised cleanly instead. Closes #1380.
