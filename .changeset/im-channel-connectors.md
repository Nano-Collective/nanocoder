---
"@nanocollective/nanocoder": minor
---

Add chat channel connectors: `nanocoder channels start` bridges Telegram, Slack, and Discord to the per-project daemon so you can message your local agent from your phone or team chat. Configure under `nanocoder.channels` with an `allowedUsers` list per platform. The daemon gains a `prompt` IPC method that runs a free-form instruction (checkpointed, headless or plan mode) for any local client.
