---
'@nanocollective/nanocoder': patch
---

Fix Shift+Enter scrambling a multi-line message instead of adding a line break.

Typing `one`, Shift+Enter, `two`, Shift+Enter, `three` submitted `onetwothree` with two trailing blank lines. Both newline shortcuts appended to the END of the composer value and never moved the caret, so each word after the first was spliced in at the offset the caret had been left at. Ctrl+J was affected too: it only looked correct because the caret is usually already at the end, where appending happens to produce the same string as inserting.

The insert now happens at the caret, inside the component that owns it. `TextInput` handles Shift+Enter and Ctrl+J itself rather than having the composer append behind its back, and a typed character, Ctrl+J and Shift+Enter all share one insertion path instead of three near-copies. Ctrl+J under the kitty keyboard protocol, which used to be dropped entirely, now inserts a break like every other encoding of it.

Shift+Enter inserts a line break in every text input, not only the composer. A literal LF was already accepted everywhere, so this makes the CSI-u and kitty encodings agree with behaviour the component already had.

Thanks to @addyCooks. Closes #1326.
