---
'@nanocollective/nanocoder': patch
---

Pressing Escape on an empty composer no longer offers to "clear" it. Escape armed the two-press clear hint unconditionally, so it appeared even when there was no text, no attachments and no active-editor pill to clear. It now only arms when there is something to clear, and Escape still clears an attached VS Code file pill on its own when the composer text and attachments are otherwise empty. Closes #1430.
