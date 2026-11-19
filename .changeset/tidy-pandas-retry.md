---
"@nanocollective/nanocoder": patch
---

Saving a session no longer fails when another Nanocoder process is reading the
session index on Windows. The atomic write now retries a rename that the
filesystem refuses because the target is open (EPERM/EBUSY/EACCES) with bounded
exponential backoff, instead of dropping the index update and leaving the
session missing from `/resume` until the next start.
