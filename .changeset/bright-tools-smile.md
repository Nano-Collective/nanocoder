---
"@nanocollective/nanocoder": minor
---

Add per-run `--allowed-tools` and `--disallowed-tools` flags so one `run` (or TUI session) can narrow which built-in, custom, skill and MCP tools are offered, without editing `disabledTools`. Deny wins over allow, `*` matches a family of names, and a subagent's `tools` / `disallowedTools` frontmatter uses the same matching. An unknown name fails the run with the valid tool list, and the active filter appears in `/status`, the boot summary and the `--json` report. Closes #2274.
