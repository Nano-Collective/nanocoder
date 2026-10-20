---
"@nanocollective/nanocoder": patch
---

Fix diff preview edge cases in VS Code extension:
- Resolve diff collisions when ACP notifications carry multiple diff blocks under the same tool call ID by uniquely keying pending changes with compound IDs, and open only the matching file diff when clicked from the chat webview.
- Avoid terminal focus stealing when opening a diff preview from the chat webview.
- Add `clearPendingChanges()` to clean up pending diffs and virtual documents on session reset, resume, and new chat.
