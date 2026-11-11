---
"@nanocollective/nanocoder": patch
---

`--trust full-commit` no longer pushes a fix that touches files which run code. If the fix changes `.github/`, a `.git*` file, git hook setups, lockfiles, a `package.json`'s scripts or dependencies, `.nanocoder/`, `agents.config.json` or `.mcp.json`, the daemon pushes nothing and reports the diagnosis with an error naming those files.
