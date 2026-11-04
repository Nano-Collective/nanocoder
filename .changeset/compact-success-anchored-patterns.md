---
'@nanocollective/nanocoder': patch
---

Fixed default compaction replacing an entire tool result with `Result: success` whenever the body merely mentioned success somewhere. The success patterns for "completed successfully" and "no errors" were unanchored, so a log like `Build completed successfully` followed by `failures: 3` was collapsed into a blanket success claim and the failure detail was lost. Success patterns now only match the whole trimmed body. A body mixing success and failure mentions keeps the first line plus the line that reports the failure, so a failure reported past the leading lines is never truncated away while the success line stays. Negated outcome phrasing such as "no errors" or "0 failures" no longer counts as a failure mention. Closes #1633.
