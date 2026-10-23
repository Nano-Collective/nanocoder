---
"@nanocollective/nanocoder": minor
---

Added shell-style reverse prompt history search (`Ctrl+R` / `bck-i-search`) in the CLI chat input. Users can now search past prompts chronologically with case-insensitive substring matching, cycle through older matches by pressing `Ctrl+R` repeatedly, accept and populate the input field with `Enter` (preserving any attachments or placeholders), or cancel and restore their in-progress draft with `Esc`. The reasoning trace toggle shortcut has moved from `Ctrl+R` to `Ctrl+N` (`Ctrl+G` is voice push-to-talk and `Ctrl+T` stays reserved for the live task list). Closes #936.

Malformed prompt history entries are cleaned up on load so they cannot break the search.
