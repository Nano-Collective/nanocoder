---
"@nanocollective/nanocoder": patch
---

Added `/commit --copy` (short form `-c`), which copies the generated Conventional Commit message to the system clipboard. If the clipboard is unavailable the message is still shown with a note, rather than being lost, and an unrecognised option now reports a usage line instead of being silently ignored. `/commit` also shows a spinner while the model generates the message, so the round-trip is no longer a silent pause - commands opt into this by declaring `progressLabel`.
