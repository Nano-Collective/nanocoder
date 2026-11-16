---
"@nanocollective/nanocoder": patch
---

Fix the VS Code extension losing session sync on ACP backend process restart or reconnection. When the backend reconnects, the active session is automatically resumed; if the backend cannot resume the session (e.g. process restarted with fresh state), stale webview messages are cleared and the user is informed that the agent process was restarted in a fresh session. Closes #1719.
