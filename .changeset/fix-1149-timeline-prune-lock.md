---
"@nanocollective/nanocoder": patch
---

Fixed `TimelineManager` pruning an active session whose directory `mtimeMs` was older than `MAX_TIMELINE_SESSION_AGE_MS`. Each session now holds a per-process lockfile at `.nanocoder/timeline/<sessionId>/.lock`, published atomically via a temp file plus hard `link` so concurrent readers never observe a half-written lock; `pruneStaleSessions` probes the lock and removes the entry only when the lock is missing, malformed, held by a dead PID, or older than 24h by file mtime. The mtime is refreshed on every capture so long-lived sessions keep their protection, a resumed session reaps a dead predecessor's lock before acquiring, and `clear()` resets the in-memory claim so the next capture re-acquires. Closes #1149.
