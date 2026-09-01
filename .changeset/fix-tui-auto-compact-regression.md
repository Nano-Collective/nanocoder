---
"@nanocollective/nanocoder": patch
---

Fix auto-compact silently no-opping in the TUI after the shared-helper refactor. `maybeAutoCompact` derived the provider and model from the client and swallowed any failure, so the chat loop's own `currentProvider`/`currentModel` were ignored; it now accepts them as explicit overrides. Auto-compact in `--plain`, ACP, and subagent loops also stops writing the message cap back into stored history when no compaction ran.
