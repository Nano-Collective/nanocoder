---
"@nanocollective/nanocoder": patch
---

`nanocoder daemon stop` no longer terminates an unrelated process that reused the lockfile's PID. The daemon's lockfile now counts as live only if its IPC endpoint still exists, so `status`, `start` and `stop` clean up a stale lockfile after a crash or reboot instead of reporting a running daemon. `stop` sends SIGTERM only after IPC has confirmed the daemon, and says so when the daemon cannot be reached.
