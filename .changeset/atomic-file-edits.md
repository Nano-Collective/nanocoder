---
"@nanocollective/nanocoder": patch
---

Fixed `write_file`, `string_replace`, `diff_edit` and `lsp_format_document` leaving a truncated source file behind when a write failed part way through (disk full, process killed). Edits are now written to a temporary file next to the original and swapped in, so the file holds either the old or the new content. Symlinks, file permissions and owners, and hard links are kept as before. Closes #2172.
