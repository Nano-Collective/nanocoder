---
"@nanocollective/nanocoder": patch
---

Fixed the nano-profile architect-mode system prompt, whose "TASK APPROACH — ARCHITECT MODE" heading was stored with an invalid UTF-8 byte and reached the model as a replacement character. A new test checks that every prompt section file is valid UTF-8.
