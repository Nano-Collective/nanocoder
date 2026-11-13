---
"@nanocollective/nanocoder": patch
---

ACP `session/resume` now finds a session that was created but has not finished a turn yet. Such a session is only written to disk once it has something to keep, so resuming it straight after `session/new` used to fail with "Session not found on disk". It now resumes the live session as it is.
