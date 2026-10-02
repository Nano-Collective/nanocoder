---
'@nanocollective/nanocoder': patch
---

Ctrl+A, Ctrl+E, Ctrl+U and Ctrl+K in the prompt now act on the current line, not the whole multi-line buffer. Ctrl+U on the last line of a three-line prompt used to clear all three lines with no undo, and Ctrl+A/Ctrl+E jumped to the very start/end of the prompt instead of the current line, matching the `?` shortcuts legend's "Move/Delete to start or end of line" only when the prompt had a single line. Closes #1530.
