---
"@nanocollective/nanocoder": patch
---

Fixed a slash command with leading whitespace being sent to the model as a chat message instead of running. `parseInput` trims before testing for the `/` prefix but the routing in `handleMessageSubmission` did not, so `  /help` reached the LLM. With lifecycle hooks configured it also fired `user-prompt-submit` and consumed buffered `session-start` context for an input that never reaches the model. Both the routing and the hook's local-action check now trim, matching the `!` bash passthrough. Also added `nanocoder.hooks` to the `agents.config.json` JSON Schema — hooks landed alongside the schema and were missing from it, so every documented hooks example was flagged as an unknown key in editors.
