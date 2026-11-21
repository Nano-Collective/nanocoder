---
"@nanocollective/nanocoder": patch
---

`AGENTS.md` now supports `@path` imports: a line that is only `@docs/testing.md` (or `@~/guides/style.md` for your config directory) is replaced by that file's contents in the system prompt, recursively. Imports stay inside the project root or the config directory, stop after five levels, and are size-capped; anything that cannot be loaded is reported as a warning.
