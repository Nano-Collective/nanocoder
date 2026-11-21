---
'@nanocollective/nanocoder': minor
---

Added `nanocoder.permissions` with command-level `allow` and `deny` rules for tool approval. Rules are either a tool name (`execute_bash`) or a tool with a command pattern (`execute_bash(git status)`), with `*` as a wildcard. An allow rule skips the approval prompt only when it covers every simple command in the line; a deny rule refuses the call and cannot be approved by hand. Deny wins over allow, over `alwaysAllow`, and over every development mode, including yolo and headless runs, while the built-in `execute_bash` safety checks still apply. Deny also looks past common wrappers (`sudo`, `env`), leading paths, and `sh -c` strings; use `*…*` patterns when a line cannot be split safely. Rules work in interactive chat, subagents, ACP, and `--plain`. Project and user rules are combined, and project-level rule changes re-trigger the directory trust prompt. Refs #1973.
