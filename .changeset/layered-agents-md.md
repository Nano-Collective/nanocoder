---
"@nanocollective/nanocoder": minor
---

Load `AGENTS.md` in layers instead of only from the project root. Nanocoder now reads a user-level `<config dir>/AGENTS.md` (respecting `NANOCODER_CONFIG_DIR`) and picks up nested `AGENTS.md` files from subdirectories once the agent reads or edits files there. Files are ordered from broadest to closest so nested rules win on conflicts, each is capped at 32,000 characters with a visible truncation note, and ignored directories are skipped. Nested rules travel in the user message at request time so the system prompt stays cacheable. Nested layers also share a 64,000-character total budget: closest files are kept first and any dropped file is named in a note to the model, while symlinked or escaped directories cannot contribute rules.
