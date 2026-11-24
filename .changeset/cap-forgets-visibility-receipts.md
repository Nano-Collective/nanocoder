---
"@nanocollective/nanocoder": patch
---

When a long conversation is trimmed to `sessions.maxMessages`, files whose `read_file` results were dropped now lose their read-before-edit visibility receipts, so `string_replace`, `diff_edit` and `write_file` ask for a fresh read instead of allowing an edit on lines the model can no longer see. A file whose content is still shown in the messages sent, through a later read or the model's own write or edit of it, keeps its receipt; a `metadata_only` read does not count, since it shows no content.