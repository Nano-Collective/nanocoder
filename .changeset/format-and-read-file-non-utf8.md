---
'@nanocollective/nanocoder': patch
---

Fixed `lsp_format_document` damaging files that aren't valid UTF-8, such as Latin-1, Windows-1252 or Shift-JIS files. It applied the language server's edits to the file decoded as UTF-8 and wrote the whole file back, so every byte that didn't decode was rewritten as U+FFFD, including outside the edits, and it still reported the file as formatted. It now refuses these files with the same error as `string_replace` and `diff_edit`, before asking the language server for edits, and leaves the file unchanged. `read_file` with `metadata_only` also no longer labels such a file `Encoding: UTF-8`: it reports that the file isn't valid UTF-8. UTF-8 files, including ones with non-ASCII text, format and are labelled as before. Thanks to @diyaavirmani. Closes #1867.
