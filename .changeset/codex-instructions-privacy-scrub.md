---
"@nanocollective/nanocoder": patch
---

With privacy scrubbing on, the ChatGPT/Codex provider now sends the scrubbed system prompt as `instructions`. It was built from the text before scrubbing, so the original prompt, including any project context in it, reached the provider even though the input items were scrubbed.
