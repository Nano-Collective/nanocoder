---
"@nanocollective/nanocoder": patch
---

Re-enable project-level MCP credential scanning. `loadAppConfig` dropped the loader wrapper's `source` before `validateProjectConfigSecurity` filtered on it, and env substitution ran before the scanner so `$API_KEY` looked hardcoded. Capture `source` and pre-substitution `rawEnv`/`rawHeaders` so only real literals warn. Closes #1248.
