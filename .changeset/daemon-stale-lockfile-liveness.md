---
"@nanocollective/nanocoder": patch
---

Verify daemon IPC responsiveness when checking lockfile liveness, preventing stale lockfiles with recycled PIDs from falsely reporting running daemons or signaling unrelated host processes during `nanocoder daemon stop`.
