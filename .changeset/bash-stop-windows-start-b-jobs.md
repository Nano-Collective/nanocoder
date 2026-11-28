---
"@nanocollective/nanocoder": patch
---

On Windows, `execute_bash` now stops jobs that a finished command left running, such as one started with `start /b`, when Nanocoder shuts down. cmd.exe exits as soon as `start /b` returns, so these jobs were never tracked and kept running after exit. When a command finishes while something still holds its output pipes, Nanocoder looks up the processes cmd.exe started and stops them by their own pids. Closes #2342.
