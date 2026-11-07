---
"@nanocollective/nanocoder": patch
---

`write_file` now keeps CRLF line endings when it overwrites a CRLF file. Models send LF, so rewriting a CRLF file turned every line into LF. When most of the existing file's lines end in CRLF, every line break in the new content is written as CRLF, including content that mixes both. New files and LF files get the content as sent. The terminal diff, the VS Code diff and the ACP diff shown in editors use the same line endings. Closes #1964.
