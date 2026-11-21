---
"@nanocollective/nanocoder": patch
---

Fixes for named configuration profiles:

- `config show` now reports `nanocoder.defaultMode` from the active profile (the profile layer, not built-in) when the profile sets `mode`; an invalid profile mode falls back to the project/global default.
- MCP servers declared in `nanocoder.profiles.<name>.mcpServers` are now loaded when the profile is active (between env and project precedence), instead of being silently ignored.
- `docs/configuration/index.md`: the profile example's nonexistent `contextLimit` key is replaced with `retries`.
- Directory-trust fingerprint version bumped to 2 because trusted folders using top-level `mode` or `firewall` settings now fingerprint those settings.
- `loadHierarchicalConfig` no longer throws when the active profile is removed mid-session; it falls back to the files instead.
