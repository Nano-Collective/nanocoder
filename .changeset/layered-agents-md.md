---
'@nanocollective/nanocoder': minor
---

Load `AGENTS.md` in layers instead of only from the project root. Nanocoder now also reads the user-level `<config dir>/AGENTS.md` (respecting `NANOCODER_CONFIG_DIR`) and picks up nested `AGENTS.md` files from project subdirectories once the agent reads or edits files there. Files are ordered from broadest to closest, so a nested file wins on conflicts, and each file is capped at 32,000 characters with a visible truncation note. `tune.includeAgentsMd` and the nano profile still turn every layer off together.
