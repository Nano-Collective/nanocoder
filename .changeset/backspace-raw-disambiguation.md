---
"@nanocollective/nanocoder": patch
---

Fixed Backspace deleting the character after the cursor on virtually every terminal. Ink parses both the physical Backspace (`\x7f`, sent by macOS Terminal, iTerm2 and essentially all Linux terminals) and the forward Delete key (`\x1b[3~`) as `key.delete`, so Backspace was routed to a forward delete (a no-op at end of line). TextInput now disambiguates at the raw-sequence level so Backspace always deletes backward.

Fixed undo/redo reading stale stacks when an edit and an undo/redo arrive in the same stdin batch. `pushToUndoStack` now keeps the undo/redo stack refs in lockstep synchronously (not just after a render), and `redo()` now caps the undo stack it pushes back onto, matching `undo()`.