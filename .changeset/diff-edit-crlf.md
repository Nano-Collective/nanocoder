---
"@nanocollective/nanocoder": patch
---

`diff_edit` now works on files with CRLF line endings. Models send LF, so a multi-line SEARCH block on a CRLF file was refused with `Search block 1 was not found in file`, and REPLACE text that added lines wrote LF lines into the file. Each SEARCH/REPLACE block is now fitted to the file's line endings the same way as `string_replace`. LF files are unchanged, and a multi-line LF block that only matches an LF part of a mixed file is applied as sent. The validator and the VS Code diff use the same matching. Closes #1993.
