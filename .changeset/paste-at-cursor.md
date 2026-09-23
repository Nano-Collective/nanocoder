---
'@nanocollective/nanocoder': patch
---

Paste bracketed text at the caret, not at the end of the input.

A terminal paste (DECSET 2004) used to append to the end of the prompt no matter where the caret was. The TextInput caret is now read before the splice and restored after, so pasting with the cursor in the middle of existing text drops the placeholder exactly where you were editing and parks the caret right after it. Pasting at end-of-value still works the same way it always did, and the heuristic paste detector paths are unchanged.

Also exposes a `TextInputHandle` (`getCursorOffset` / `setCursorOffset`) on `TextInput` so the parent can drive the caret without lifting its state up the tree.
