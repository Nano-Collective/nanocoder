---
"@nanocollective/nanocoder": patch
---

Deprecate the legacy VS Code companion started by `--vscode` (and `/ide`). The VS Code extension now runs the agent itself over ACP, so the WebSocket companion duplicates it and will be removed in a future release. Nanocoder now prints a one-time warning when the companion is enabled, pointing to the sidebar chat, and `--help` marks the flag as deprecated.
