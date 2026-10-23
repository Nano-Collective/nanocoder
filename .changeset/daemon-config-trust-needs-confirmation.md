---
"@nanocollective/nanocoder": patch
---

`nanocoder daemon start` no longer lets `verify.trustLevel` in `agents.config.json` raise the CI investigation level on its own. A config-sourced `auto-fix` now asks for confirmation in a terminal and a config-sourced `full-commit` needs the same one-time confirmation as `--trust full-commit`. Unattended starts that cannot ask, including the service installed by `nanocoder daemon install`, fall back to `comment-only` unless the project was already confirmed for `full-commit`. Passing `--trust <level>` explicitly works as before.
