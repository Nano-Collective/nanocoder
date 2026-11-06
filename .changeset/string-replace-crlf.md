---
"@nanocollective/nanocoder": patch
---

`string_replace` now works on files with CRLF line endings. Models send LF, so a multi-line edit on a CRLF file was refused with "Content not found", and an edit that added lines wrote LF into the file, leaving mixed line endings. `old_str` and `new_str` are now converted to the file's dominant line ending before matching and writing. Closes #1930.
