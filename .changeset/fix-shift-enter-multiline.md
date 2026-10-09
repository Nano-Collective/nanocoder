---
'@nanocollective/nanocoder': patch
---

Shift+Enter now adds a line break at the cursor instead of scrambling the message. Typing `one`, Shift+Enter, `two`, Shift+Enter, `three` used to submit `onetwothree` with two trailing blank lines, because the break was appended to the end of the composer value while the caret stayed put, so every later word landed at the stale offset. Ctrl+J was affected the same way and only looked right because the caret is usually already at the end. Closes #1326.
