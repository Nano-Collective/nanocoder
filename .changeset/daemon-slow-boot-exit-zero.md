---
'@nanocollective/nanocoder': patch
---

Fixed `nanocoder daemon start` treating a slow boot as a failure: when the daemon is still starting after the five-second lockfile wait, the command now exits 0 and points at `nanocoder daemon status` instead of reporting an error and exiting 1, so scripts and service managers no longer see a failed start for a daemon that comes up. Part of #1737.
