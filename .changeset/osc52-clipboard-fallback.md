---
"@nanocollective/nanocoder": patch
---

`/copy`, `/copy code` and `/commit --copy` now fall back to the OSC 52 terminal escape sequence when the system clipboard fails, and also send it over SSH, so copying works from remote and headless sessions. The message says when the terminal route was used, because the terminal cannot confirm it.
