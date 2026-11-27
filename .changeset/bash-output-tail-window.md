---
"@nanocollective/nanocoder": patch
---

`execute_bash` and custom tools no longer drop the end of a command's output once it passes the 5 MB per-stream cap. The cap now keeps the start and the most recent 256 KB, with a notice naming the omitted bytes and the true stream total between them, so the build or test summary printed last still reaches the model. Timed-out or cancelled floods keep that notice and ending too; background jobs continue to keep only their latest output. Closes #2237.
