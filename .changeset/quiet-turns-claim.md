---
"@nanocollective/nanocoder": patch
---

Fixed ACP prompts racing with each other by claiming session turns before asynchronous setup begins, preventing overlapping prompts from corrupting turn state. Closes #1038.
