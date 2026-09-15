---
"@nanocollective/nanocoder": patch
---

Fixed `string_replace`, `diff_edit` and `write_file` destroying PDF and DOCX files. Reading one of those formats returns a markdown transcript rather than the bytes on disk, and the write side had no matching branch: the edit was applied to the transcript and written back over the document as UTF-8, so a request to fix one word replaced a real document with a few hundred bytes of plain text and the tool reported success. Neither undo system could recover it - checkpoints skip binaries and file snapshots store text - so the original bytes were gone the moment the write landed. The three write tools now refuse any path whose content the read path can only transcribe, naming the reason so the model stops instead of retrying. Closes #1058.
