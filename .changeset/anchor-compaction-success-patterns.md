---
"@nanocollective/nanocoder": patch
---

Fixed default compaction collapsing a multi-line tool result into `Result: success` whenever it mentioned "completed successfully" or "no errors" anywhere, which dropped failure lines that followed. Only a short single-line result is treated as a success marker now. Closes #1633.
