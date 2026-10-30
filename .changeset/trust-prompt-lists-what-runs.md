---
'@nanocollective/nanocoder': minor
---

The directory trust prompt now lists the plugins, hooks, formatters, LSP servers, MCP servers, custom tools, and subscribed skills, agents, and commands in the folder. Trust stores a fingerprint of those files, and the prompt comes back when they change. A folder trusted before this change is asked again once. Older versions can't read the new `trustedDirectories` entries and fail the trust check, so remove them before downgrading. Closes #1659.

The fingerprint also covers the project `.env`, the `agents.config.json` settings that relax confirmations (`alwaysAllow`, `defaultMode`, `sandbox`, `verify.trustLevel`) and project provider `baseUrl`s.
