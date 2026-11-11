---
"@nanocollective/nanocoder": patch
---

Add `--output-format stream-json` to `nanocoder run`: one JSON event per line on stdout (`session_start`, `assistant_text` deltas, `tool_call` / `tool_result`, per-response `usage`) ending with a `result` event carrying the same report `--json` prints, so CI jobs and editor integrations can follow a run live instead of waiting for it to end.
