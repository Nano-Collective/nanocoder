---
"@nanocollective/nanocoder": minor
---

Added a `/jobs` command for background `execute_bash` jobs: it lists running and retained jobs with their id, status, runtime and command, shows a bounded tail of a job's retained output with `/jobs <id>`, and stops jobs with `/jobs kill <id>` or `/jobs kill all`. Job ids can be abbreviated to an unambiguous prefix, and inspecting output in the TUI does not move the cursor used by the model's `bash_output`, so text already read by the model stays visible. A running-jobs count now appears in the status bar while any background job is active. Closes #2356.
