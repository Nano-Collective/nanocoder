---
"@nanocollective/nanocoder": minor
---

Add content-addressed `@span:xx` edit handles as an alternative to `string_replace`'s exact-text matching. `read_file` and `search_file_contents` now tag the content they return with a short handle; a new `replace_span` tool resolves a handle back to its file and line range, rechecks its content hash against the live file, and applies the edit — so a model no longer has to retype the original source exactly to edit it, and a stale handle (file changed since, or shifted by an earlier span's own edit) fails cleanly instead of corrupting the file. `string_replace` is unchanged and remains available. Closes #1575.
