---
"@nanocollective/nanocoder": minor
---

A project `.env` can no longer set variables that act before you trust the folder. It is loaded before the directory trust check, and until now only seven keys were blocked, so a cloned repo could still point Nanocoder at its own providers (`NANOCODER_PROVIDERS`), move the data and log directories, or inject code into every MCP server, hook and git command with `NODE_OPTIONS`, `BASH_ENV` or `GIT_CONFIG_*`. Now every `NANOCODER_*` variable except `NANOCODER_LOG_LEVEL`, `NANOCODER_CONTEXT_LIMIT`, `NANOCODER_MAX_TURNS` and `NANOCODER_NO_UPDATE_CHECK` is blocked, along with process start-up, search path, home and config directory, TLS and proxy variables. Skipped keys are named in the startup warning. Set them in your shell instead. API keys and other ordinary variables still load from `.env` as before.
