---
'@nanocollective/nanocoder': patch
---

Fixed `nanocoder daemon start` treating a slow boot as a failure: when the daemon is still starting after the five-second lockfile wait, the command now exits 0 and points at `nanocoder daemon status` instead of reporting an error and exiting 1, so scripts and service managers no longer see a failed start for a daemon that comes up. `start` also publishes a starting lockfile while it boots, so a concurrent `start` now reports that the daemon is starting instead of launching a second daemon that dies with "already running" once the first one finishes. `daemon status` reports the booting state too. Closes #1737.
