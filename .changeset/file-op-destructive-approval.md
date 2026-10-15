---
'@nanocollective/nanocoder': patch
---

Fixed `file_op` deleting or overwriting files without a prompt in `auto-accept`, the mode ACP sessions start in. A delete, or a move or copy onto a file that already exists, now asks for approval there the same way `rm` through `execute_bash` does, because it shows no diff and cannot be undone. File edits, `mkdir`, and moves or copies to a new path still run unprompted. `architect` (which checkpoints the change), headless runs, `yolo`, and tools listed in `alwaysAllow` are unchanged. Non-interactive `nanocoder run` stops with `Tool approval required` on such a call, as it already does for bash. Thanks to @diyaavirmani. Closes #1683.
