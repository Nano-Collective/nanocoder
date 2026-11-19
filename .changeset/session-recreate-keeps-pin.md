---
"@nanocollective/nanocoder": patch
---

Autosave no longer drops a session's pin, creation time or chosen title when it recreates the session over a file it cannot read. `createSession` now keeps `pinned`, `createdAt`, and a title that was renamed or generated (with its flag) from the session's index entry, unless the caller passes a rename of its own.
