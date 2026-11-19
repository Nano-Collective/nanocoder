---
"@nanocollective/nanocoder": patch
---

Saving a session over a file that cannot be read no longer drops its pin, creation time or chosen title. The CLI's autosave (through `createSession`) and the ACP save path now take `pinned`, `createdAt`, and a renamed or generated title with its flag from the session's index entry. A value the caller passes still wins.
