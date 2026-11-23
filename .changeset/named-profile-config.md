---
"@nanocollective/nanocoder": patch
---

Fixes for named configuration profiles:

- `config show` now reports `nanocoder.defaultMode` from the active profile (the profile layer, not built-in) when the profile sets `mode`; an invalid profile mode falls back to the project/global default.
- MCP servers declared in `nanocoder.profiles.<name>.mcpServers` are now loaded when the profile is active (between env and project precedence), instead of being silently ignored.
- `docs/configuration/index.md`: the profile example's nonexistent `contextLimit` key is replaced with `retries`.
- Directory-trust fingerprint version bumped to 2 (top-level `mode` and `firewall` are now fingerprinted). Every previously trusted folder is re-asked once — recheck reason "upgrade" ("needs re-approval after the upgrade") — because old entries are version 1 and the version check is exact, not only folders using `mode` or `firewall`. Folders trusted after the bump record version 2 and skip the one-time re-prompt.
- `loadHierarchicalConfig` no longer throws when the active profile is removed mid-session; it falls back to the files instead.
