---
'@nanocollective/nanocoder': patch
---

Config files created by the provider and MCP setup wizards, `/setup-config`, and the empty config seeded on first run are now created owner-only (`0600`) and saved atomically. A fresh install no longer leaves plaintext API keys and bearer tokens world-readable, and an interrupted save can no longer truncate the file. Existing files keep their current permissions, and symlinked configs are updated through the link instead of replacing it. The wizard summary now warns when the config is being saved inside a project, where keys can be committed. Closes #1981.
