---
"@nanocollective/nanocoder": minor
---

`execute_bash` can now start long-running processes with `run_in_background: true`. It returns a job id and the first second of output instead of blocking, and two new tools work with that id: `bash_output` returns only the output produced since the previous read, and `kill_bash` stops the job's process group. Background jobs share the normal approval and sandbox path, are capped by the existing output collector, and are stopped by `kill_bash`, when their session closes, or when Nanocoder exits. Closes #1974.
