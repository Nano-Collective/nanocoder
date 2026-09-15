---
"@nanocollective/nanocoder": patch
---

Fixed `TimelineManager` pruning an active session whose directory `mtimeMs` was older than `MAX_TIMELINE_SESSION_AGE_MS`. Each session now holds a per-process lockfile at `.nanocoder/timeline/<sessionId>/.lock`; `pruneStaleSessions` probes the lock and reaps the entry only when the lock is missing, malformed, or pointing at a dead PID. `TimelineManager.dispose()` is now a public method to release the lock. Closes #1149.
