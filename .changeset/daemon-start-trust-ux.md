---
"@nanocollective/nanocoder": patch
---

Clearer `nanocoder daemon start --trust` handling. Running it while a daemon is already running now says the requested level was not applied and shows the level in use, and `nanocoder daemon status` reports the running daemon's CI trust level. `--trust=<level>` is accepted alongside `--trust <level>`, and `--trust` with no level (for example `--trust --trust-directory`) now says a level is required instead of reporting an empty invalid value.
