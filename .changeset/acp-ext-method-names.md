---
"@nanocollective/nanocoder": minor
---

ACP extension requests now use the `_` prefix ACP reserves for custom methods: `_nanocoder/renameSession`, `_nanocoder/timeline/list`, `_nanocoder/timeline/revert` and `_nanocoder/retryTurn`. The bare names still work as deprecated aliases and log a one-time notice, and will be removed in a later release. `initialize` now lists the exact method and notification names under `agentCapabilities._meta.nanocoder`, so a client can detect support instead of guessing from the version. A custom request the agent doesn't recognise now fails with the standard "Method not found" (`-32601`) instead of a plain error. The VS Code extension uses the advertised names and falls back to the bare ones for an older agent.
