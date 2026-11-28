---
"@nanocollective/nanocoder": patch
---

Use the same editor launcher for configuration wizards and /setup-config. Support editor arguments and quoted executable paths, prefer VISUAL over EDITOR, pass config paths literally, and restore terminal raw mode after editing.

Behavior changes: the default editor for `/setup-config` is now `nano` (was `vi`), and both `/setup-config` and the wizards prefer `VISUAL` over `EDITOR`. On Windows the editor is resolved via PATHEXT and `.cmd`/`.bat` shims (such as VS Code's `code`) are launched through cmd.exe with quoted arguments.
