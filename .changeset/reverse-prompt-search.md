---
"@nanocollective/nanocoder": minor
---

Added shell-style reverse prompt history search (`Ctrl+R` / `bck-i-search`) in the CLI chat input. Users can now search past prompts chronologically with case-insensitive substring matching, cycle through older matches by pressing `Ctrl+R` repeatedly, accept and populate the input field with `Enter` (preserving any attachments or placeholders), or cancel and restore their in-progress draft with `Esc` or `Ctrl+C`. The reasoning trace toggle shortcut has been moved to `Ctrl+G` to free up `Ctrl+R` while keeping `Ctrl+T` reserved for the live task list. Closes #936.
