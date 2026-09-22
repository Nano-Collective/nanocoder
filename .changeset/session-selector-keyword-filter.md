---
"@nanocollective/nanocoder": patch
---

Added keyword search to the `/resume` session selector. Typing now filters the session list by title, using the same type-to-filter list as the model picker, so an old conversation no longer has to be found by scrolling and guessing by date. The filter matches the title only, not the message count or age shown next to it; Backspace edits the query, arrow keys and Enter pick from the filtered results, and Esc cancels. Closes #1316.
