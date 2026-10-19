---
'@nanocollective/nanocoder': patch
---

Fixed commands started by `execute_bash` running on after nanocoder had exited and writing to the project. Each command runs in its own process group, so it did not get the hangup when the terminal closed, and a command that ignored SIGTERM outlived a timeout or cancel whenever nanocoder exited within the 2 seconds before its SIGKILL fallback. Closing the terminal or dropping an SSH session (SIGHUP) now shuts nanocoder down the same way SIGTERM does, and shutdown stops every command that is still running, including jobs a finished command left in the background with `cmd &`: SIGTERM first, then SIGKILL after 2 seconds. A timeout or cancel is now reported only once the command has actually stopped, so a `nanocoder run` can no longer finish around it. Thanks to @diyaavirmani. Closes #1833.
