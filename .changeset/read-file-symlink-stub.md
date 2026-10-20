---
'@nanocollective/nanocoder': patch
---

Fixed `read_file` telling the model that a symlinked file was "already in context, unchanged since last read" after the file it points to had changed, for example `AGENTS.md` linked to `CLAUDE.md` after `CLAUDE.md` was edited. The repeat-read check compared the link's own modification time and size, which do not change when the target does. It now compares the target's, so the changed content is returned, and unchanged links still get the short stub. `metadata_only` still describes the link itself. Thanks to @diyaavirmani. Closes #1834.
