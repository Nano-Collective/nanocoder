---
"@nanocollective/nanocoder": minor
---

ACP clients can now exempt a session from retention with the new `_nanocoder/pinSession` extension method (`sessionId`, `pinned`). Neither `retentionDays` nor `maxSessions` deletes a pinned session, and pinned sessions do not count toward `maxSessions`; `session/delete` still removes them. `session/list` entries report the mark as `_meta["nanocoder/pinned"]`, and `initialize` reports the effective `retentionDays` and `maxSessions` as `_meta["nanocoder/retention"]`.
