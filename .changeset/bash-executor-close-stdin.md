---
"@nanocollective/nanocoder": patch
---

`execute_bash` now closes the command's stdin on every spawn path (Unix, Windows `cmd.exe`, and the macOS/Linux sandbox), so commands that wait for input (interactive prompts, `cat` with no file, editors) get EOF and fail fast instead of hanging until the 2 minute timeout. Closes #1978.
