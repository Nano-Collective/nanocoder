---
'@nanocollective/nanocoder': minor
---

Render optional description/intent field in tool approval preview cards. Tools that modify files or execute shell commands (`execute_bash`, `string_replace`, and `write_file`) now accept an optional `description` parameter in their schemas, which renders above the command or path in the approval card to make the model's intent clear before execution.
