---
"@nanocollective/nanocoder": patch
---

When a long conversation is trimmed to `sessions.maxMessages`, files whose `read_file` results were dropped now lose their read-before-edit visibility receipts, so `string_replace`, `diff_edit` and `write_file` ask for a fresh read instead of allowing an edit on lines the model can no longer see. A file read again in the messages still sent keeps its receipt.