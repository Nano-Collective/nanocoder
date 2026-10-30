---
"@nanocollective/nanocoder": patch
---

ACP editors now see a failed tool call as failed. The status was set to `failed` only when the result text started with "Error", so a command that exited non-zero, a missing file and a validation failure all reached the editor as `completed`. The status now also follows the `isError` flag that `processToolUse` already sets for these, which also stops a `write_plan` that failed validation from counting as a written plan.
