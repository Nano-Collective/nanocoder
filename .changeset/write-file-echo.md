---
"@nanocollective/nanocoder": patch
---

`write_file` no longer echoes the full file contents back after writing. The model already authored that content as the tool call arguments, so returning it again was pure duplication that scaled with file size and got re-sent on every later step of the agent loop. The confirmation message (line/char/token counts) is unchanged.
