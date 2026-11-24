---
"@nanocollective/nanocoder": minor
---

Added two lifecycle hook events. `turn-end` fires once per prompt after the model's final assistant message in the interactive TUI and in `run` / `--plain`, exposing `NANOCODER_MESSAGE_COUNT`, `NANOCODER_FILES_CHANGED` (newline-separated paths the prompt changed) and its JSON companion for paths containing newlines. A passing hook's output is shown as a status line; a non-zero exit hands its output back to the model as a new user turn, the same way `post-tool-use` failures do, capped by `nanocoder.retries.maxMalformedRetries`. Pressing Escape kills a running hook and discards its feedback. `subagent-end` fires once for every delegated subagent run that starts, exposing `NANOCODER_SUBAGENT_NAME` and `NANOCODER_SUBAGENT_SUCCESS`, and is observe-only. Closes #2017.
