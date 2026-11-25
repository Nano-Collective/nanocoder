---
"@nanocollective/nanocoder": patch
---

`/init` now recognises folders and path patterns such as `src/utils` and `docs/*` on Windows. The file scanner returned paths with `\`, which the project analyzer and the AGENTS.md generator never matched. Closes #2345.
