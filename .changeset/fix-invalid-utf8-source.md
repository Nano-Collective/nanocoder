---
"@nanocollective/nanocoder": patch
---

Fixed a stray invalid UTF-8 byte in the nano architect-mode prompt section, which showed up as a replacement character in the architect-mode system prompt. A new spec now fails if any file under `source/` is not valid UTF-8. Closes #1862.
