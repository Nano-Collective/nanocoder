---
"@nanocollective/nanocoder": patch
---

`string_replace` now works on files with CRLF line endings. Models send LF, so a multi-line edit to a CRLF file was refused with `Content not found in file`, and an edit that added lines wrote LF lines into the file. When most of a file's lines end in CRLF, `old_str` and `new_str` are now converted to CRLF before matching and writing. LF files are unchanged, and an LF edit that only matches an LF part of a mixed file is applied as sent. The validator, the terminal preview and the ACP diff shown in editors use the same matching. Closes #1930.
