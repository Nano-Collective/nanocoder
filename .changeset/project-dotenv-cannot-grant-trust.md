---
"@nanocollective/nanocoder": patch
---

A project `.env` can no longer mark its own folder as trusted. The `.env` is loaded before the directory trust check, so a repository could ship `NANOCODER_TRUST_DIRECTORY=1` in it and skip the security disclaimer. `NANOCODER_TRUST_DIRECTORY`, `NANOCODER_CONFIG_DIR`, `NANOCODER_MCPSERVERS`, `NANOCODER_MCPSERVERS_FILE` and `NANOCODER_CI_TRUST_LEVEL` are now only honoured from your shell environment, and a warning names any that a project `.env` tried to set. Loading a `.env` also no longer prints a dotenv banner.
