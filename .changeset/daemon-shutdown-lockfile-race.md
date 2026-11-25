---
"@nanocollective/nanocoder": patch
---

Prevent a race condition during daemon shutdown where a concurrent `daemon start` could treat a closing IPC endpoint as stale and launch a second daemon. Daemon shutdown now preserves the IPC listener until cleanup finishes, and lockfile removal verifies PID ownership so an exiting daemon never removes a successor daemon's lockfile.
