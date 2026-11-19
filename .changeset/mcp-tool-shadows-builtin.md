---
'@nanocollective/nanocoder': patch
---

Fixed an MCP server tool with the same name as a built-in (for example `write_file` from the filesystem server, or `git_commit` from the git server) silently replacing the built-in, including its approval rules, so `git_commit` stopped prompting in auto-accept. If that server then went unhealthy or disconnected, the built-in was removed for the rest of the session. Built-in and custom tools now always win: the colliding MCP tool is skipped with a startup warning, and an unhealthy or disconnected server only removes the tools it registered. Thanks to @diyaavirmani. Closes #1853.
