---
"@nanocollective/nanocoder": patch
---

ACP `session/load` now fails with `Session not found on disk: <id>` for a session ID that is neither in memory nor on disk, the same error `session/resume` already returned. It used to register an empty session and succeed, so a client could not tell that a stored session was gone, and a prompt sent to that ID saved a new session under an ID the client had invented. Loading a session that exists, in memory or on disk, is unchanged.
