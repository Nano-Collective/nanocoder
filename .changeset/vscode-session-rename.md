---
"@nanocollective/nanocoder": patch
---

Improved session management in the VS Code extension:

- **Session renaming**: Sessions can now be renamed directly from the History view. A `renameSession` ACP extension method (`extMethod`) is implemented on the CLI's ACP agent and backed by the existing session manager, so a session's title can be updated in place without a full resume.
- **History view navigation**: Creating a new chat or resuming a session from the History list now returns to the active chat view instead of leaving the panel stuck on the session list.
