---
"@nanocollective/nanocoder": patch
---

Close a way out of the OS sandbox: a sandboxed `execute_bash` could write `.git/config` (for example `core.fsmonitor`) or a git hook, and the next auto-approved `git_status` or `git_diff` ran it outside the jail. With `nanocoder.sandbox` on, `.git`, `.nanocoder/`, `agents.config.json` and `.mcp.json` are now read-only inside the jail and cannot be created there, so git commands that write the repo must go through the git tools. The macOS jail also denies Apple Events and LaunchServices (`open`, `osascript`), and the Linux jail hides `/run/user/<uid>` and the Docker, Podman and system D-Bus sockets. Separately, nanocoder's read-only git calls now run with `core.fsmonitor` and hooks disabled, and `git_diff` ignores external diff and textconv drivers.
