---
"@nanocollective/nanocoder": patch
---

Fixed the VS Code extension's **Reject All** running rejection cleanups concurrently: `rejectAll()` fired the async `rejectChange()` without awaiting, so overlapping cleanups raced over shared editor state (stale tab snapshots in `closeEditors()`). Rejections now run sequentially, mirroring `applyAll()`. Thanks to @jmdlrg. Closes #725.
