---
'@nanocollective/nanocoder': patch
---

Covered the previously untested `daemon status` and `daemon stop` subcommands with regression tests.

`daemon/cli.spec.ts` had 12 tests for `start` and `logs` but none for `status` or `stop`, so a regression in either handler (wrong exit code, lockfile race, missing error handling) would not have been caught by the suite. Five new tests cover the empty-state branches (`Not running.` / `No daemon is running.`), the stale-lockfile cleanup path (which removes the lockfile and reports the previous pid), the live-status format string (pid, socket, uptime), and the live-stop shutdown path. The live-stop test forks a real child so SIGTERM lands on something other than the test runner, which would otherwise trip the shutdown manager and abort the run.

No runtime behavior change — tests only.
