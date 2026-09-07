---
"@nanocollective/nanocoder": patch
---

Fixed ACP prompts racing with each other by claiming session turns before asynchronous setup begins, preventing overlapping prompts from corrupting turn state. Built-in slash-command replies are kept in persisted session history for replay, while command-only sessions are not saved. Closes #1038.
