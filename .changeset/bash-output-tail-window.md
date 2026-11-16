---
"@nanocollective/nanocoder": patch
---

`execute_bash` and custom tools no longer drop the end of a command's output once it passes the 5 MB per-stream cap. The cap now keeps the start and the most recent 256 KB, with an "N bytes omitted" notice between them, so the build or test summary printed last still reaches the model. Closes #2237.
