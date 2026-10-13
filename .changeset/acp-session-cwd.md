---
'@nanocollective/nanocoder': patch
---

Fixed ACP sessions ignoring the working directory the editor sends in `session/new`. File tools, `execute_bash`, the git tools, the project boundary for file paths, the system prompt and `AGENTS.md` used the directory the agent process was spawned in, so when an editor started the agent elsewhere (for example with the VS Code `nanocoder.cwd` setting, or when resuming a session from another project) relative paths read and wrote the wrong files and absolute paths inside the real project were rejected. Each ACP session now works in its own `cwd`, a `cd` in one session no longer moves another, and the interactive CLI is unchanged. Project-level configuration is still read from the directory the agent starts in. Thanks to @diyaavirmani. Closes #1707.
