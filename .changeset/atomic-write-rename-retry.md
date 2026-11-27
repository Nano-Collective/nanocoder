---
"@nanocollective/nanocoder": patch
---

Retry the final rename in `atomicWriteFile` and `atomicWriteFileSync` when Windows reports a transient sharing violation (EPERM, EBUSY or EACCES), so concurrent writes to the same artifact, memory, stats, timeline or lock file no longer fail.
