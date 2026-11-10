---
'@nanocollective/nanocoder': minor
---

Added `nanocoder.permissions` with command-level `allow` and `deny` rules for tool approval. Rules are either a tool name (`execute_bash`) or a tool with a command pattern (`execute_bash(git status)`), with `*` as a wildcard. An allow rule skips the approval prompt only when it covers every simple command in the line; a deny rule refuses the call and cannot be approved by hand. Deny wins over allow, over `alwaysAllow`, and over every development mode, including yolo and headless runs, while the built-in `execute_bash` safety checks still apply. Rules work in interactive chat, subagents, ACP, and `--plain`, and project-level rule changes now re-trigger the directory trust prompt. Closes #1973.
