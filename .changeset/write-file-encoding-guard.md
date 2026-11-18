---
"@nanocollective/nanocoder": patch
---

`write_file` now refuses to overwrite a file that is not valid UTF-8, such as one in Latin-1, Windows-1252 or Shift-JIS, as `string_replace` and `diff_edit` already do. The model reads such a file decoded as UTF-8, so a rewrite replaced every byte that did not decode with U+FFFD (�). New files are not affected.
