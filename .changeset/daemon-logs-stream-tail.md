---
"@nanocollective/nanocoder": patch
---

Fixed `nanocoder daemon logs` reading the whole log file into memory to return its last 64KB, so a long-running daemon with a large log made the command allocate the entire file and stall. The tail is now streamed from a byte offset, which also corrects a byte offset applied to a decoded string: any multi-byte content in the log shifted the window and returned far less than the intended 64KB. Closes #1042.
