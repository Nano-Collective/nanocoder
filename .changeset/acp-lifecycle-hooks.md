---
"@nanocollective/nanocoder": minor
---

ACP sessions now fire the `session-start`, `user-prompt-submit` and `session-end` lifecycle hooks, as the TUI and `run` / `--plain` already do. Each editor chat is a session. `session-start` output reaches that chat's first prompt in a `<hook-context>` block. A `user-prompt-submit` hook that exits non-zero blocks the prompt before any model call and shows its reason. `session-end` runs when the chat is closed or deleted, and at shutdown for any chats still open.
