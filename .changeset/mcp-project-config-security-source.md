---
"@nanocollective/nanocoder": patch
---

Wire project-level MCP security validation to real configs again. `loadAppConfig` dropped the loader wrapper's `source` field before `validateProjectConfigSecurity` filtered on it, so hardcoded-credential warnings never fired. Closes #1248.
