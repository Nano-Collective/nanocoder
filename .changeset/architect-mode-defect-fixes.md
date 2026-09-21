---
"@nanocollective/nanocoder": patch
---

Fix six defects in architect mode's review gate. Revert now deletes files the turn created instead of leaving them on disk; Escape keeps rather than silently reverting, and the footer says so; Revert & Revise sends the instructions you typed instead of a fixed string; the composer is hidden while the gate is open, so keystrokes no longer reach two components and the gate cannot be bypassed; the checkpoint now covers every file-mutating tool architect auto-executes, including `lsp_format_document` and custom file tools; and each turn's checkpoint is released once the gate resolves. Reverting also tells the model its changes are gone, so the next turn does not edit against a stale view of disk. Adds architect to `--help` and shell completions, and documents the mode.
