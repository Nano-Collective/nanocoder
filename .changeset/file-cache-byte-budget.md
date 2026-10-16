---
"@nanocollective/nanocoder": patch
---

Add total byte budget (32 MB) and single-file size threshold (4 MB) to `read_file` cache, split `lines` on demand, and sweep expired TTL entries on insert. Refs #1781.
