---
"@nanocollective/nanocoder": patch
---

`diff_edit` now works on files with CRLF line endings. Models send LF, so a multi-line SEARCH block was refused with `Search block 1 was not found in file`, and an edit that added lines wrote LF lines into the file. Blocks are fitted to the file's line endings with `fitEditToLineEndings`, the same helper `string_replace` uses, before matching and writing. LF files are unchanged, and an LF block that only matches an LF part of a mixed file is applied as sent. The validator and the diff opened in VS Code use the same matching. Closes #1993.
