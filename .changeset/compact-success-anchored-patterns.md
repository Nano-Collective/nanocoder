---
'@nanocollective/nanocoder': patch
---

Fixed default compaction replacing an entire tool result with `Result: success` whenever the body merely mentioned success somewhere. The success patterns for "completed successfully" and "no errors" were unanchored, so a log like `Build completed successfully` followed by `failures: 3` was collapsed into a blanket success claim and the failure detail was lost. Success patterns now only match the whole trimmed body, and a body mixing success and failure mentions keeps its leading lines instead of being reduced to one line. Closes #1633.
