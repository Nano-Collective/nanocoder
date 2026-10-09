---
"@nanocollective/nanocoder": patch
---

Fix the untrusted-directory error from `nanocoder run` saying that `NANOCODER_TRUST_DIRECTORY=1` bypasses the disclaimer "for this run". Only `--trust-directory` is per-run; the environment variable saves the directory to `trustedDirectories`, so a CI job that exported it believing it was temporary permanently trusted every checkout it touched. The text and `--json` messages now say `--trust-directory` applies to this run only and `NANOCODER_TRUST_DIRECTORY=1` trusts the directory permanently, matching the daemon's message and the docs. Closes #1660.
