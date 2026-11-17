---
"@nanocollective/nanocoder": patch
---

Fixed the compact-and-retry step that runs after the model returns several empty responses in a row. Pressing Escape during the retried request now cancels it, the `pre-compact` lifecycle hook fires and `/compact --restore` can undo it (as with auto-compact and `/compact`), and the compression measures the system prompt the turn was actually sent with instead of whichever prompt was built last.
