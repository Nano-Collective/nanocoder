---
"@nanocollective/nanocoder": patch
---

Daemon-triggered (headless) subagent runs are no longer offered the `ask_user` tool. Nobody can answer in a headless run, so calling it only returned a "Question handler not initialized" error after the model had spent a turn on it.
