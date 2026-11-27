---
"@nanocollective/nanocoder": patch
---

When a long conversation is trimmed to `sessions.maxMessages`, files whose `read_file` results were dropped now lose their read-before-edit visibility receipts, so `string_replace`, `diff_edit` and `write_file` ask for a fresh read instead of allowing an edit on lines the model can no longer see. A file whose content is still shown in the messages sent keeps its receipt: a later read, a `search_file_contents` result that matched it, or the model's own successful write or edit of it. A `metadata_only` read or a failed or declined edit does not count, since neither shows the file's content.