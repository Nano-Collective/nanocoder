---
"@nanocollective/nanocoder": minor
---

read_file now returns a short stub when the same path and line range is read again and the file has not changed. Compact and /clear force a real read. Refs #793.

The stub is also invalidated when the empty-response compact-and-retry runs, and when the message cap drops the earlier read.
