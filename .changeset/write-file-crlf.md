---
"@nanocollective/nanocoder": patch
---

`write_file` now keeps CRLF line endings when it overwrites a CRLF file. Models send LF, so rewriting a CRLF file turned every line into LF. When most of the existing file's lines end in CRLF and the new content has no CRLF of its own, the content is written with CRLF. New files, LF files and content that already contains CRLF are written as sent. The terminal diff, the VS Code diff and the ACP diff shown in editors use the same line endings. Closes #1964.
