---
"@nanocollective/nanocoder": patch
---

Fix the VS Code extension's New Chat bringing back the conversation it was meant to leave. If New Chat was clicked while a session was still being created, the creation finished afterwards and wrote the old session id back, so the next prompt continued the abandoned conversation. A session creation that is overtaken by New Chat, a reconnect of the agent process, or a resumed session is now discarded, and anything waiting on it gets the current conversation's session instead. Closes #1716.
