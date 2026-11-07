---
"@nanocollective/nanocoder": patch
---

`execute_bash` now closes the command's stdin, so commands that wait for input (interactive prompts, `cat` with no file, editors) get EOF and fail fast instead of hanging until the 2 minute timeout. Closes #1978.
