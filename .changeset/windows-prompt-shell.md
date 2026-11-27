---
"@nanocollective/nanocoder": patch
---

On Windows the system prompt now reports `ComSpec` (usually `cmd.exe`) as the default shell, which is what `execute_bash` runs. Before, a `SHELL` variable set by Git Bash or MSYS2 made the prompt say bash, so models wrote bash syntax that cmd.exe could not run. Closes #2341.
