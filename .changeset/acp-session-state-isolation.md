---
"@nanocollective/nanocoder": patch
---

ACP sessions in one process no longer share per-session state. Each session keeps its own auto-compact and context-limit overrides, tune compaction preset, pre-compaction backup and last built system prompt. Lifecycle hooks now get the ACP session's own id as `NANOCODER_SESSION_ID` instead of one id for the whole process. Subagents started from a session load their definitions and project memory from that session's folder. The TUI and `--plain` are unchanged.
