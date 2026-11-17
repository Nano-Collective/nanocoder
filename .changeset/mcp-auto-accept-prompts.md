---
"@nanocollective/nanocoder": minor
---

Auto-accept mode now asks before running an MCP tool, the same as `execute_bash`, unless the server annotates the tool read-only (`readOnlyHint`) or lists it in its `alwaysAllow`. Before, auto-accept ran every MCP tool without a prompt, so a shell, database or deploy server bypassed the bash prompt. `nanocoder run` defaults to auto-accept, so a run that calls an unlisted MCP tool now stops with `tool-approval-required`: add the tool to the server's `alwaysAllow`, or pass `--mode yolo`. Daemon-triggered (headless) runs are unchanged.
