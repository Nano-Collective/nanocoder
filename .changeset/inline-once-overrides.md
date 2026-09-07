---
"@nanocollective/nanocoder": minor
---

Added `?key=value` inline overrides to slash commands (e.g. `/compact ?threshold=80`, `/context-max 128k ?auto-compact=on`). The override is applied via the existing session-override plumbing and reset to its prior value when the command finishes, so users can test a value for a single command without changing the session state. Closes #1151.
