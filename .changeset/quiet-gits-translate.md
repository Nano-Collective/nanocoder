---
"@nanocollective/nanocoder": patch
---

Preserve exact Git output bytes and decode subprocess output only after all chunks arrive, avoiding corrupted UTF-8 at stream boundaries.
