---
"@nanocollective/nanocoder": patch
---

The `nanocoder daemon install` warning for an untrusted folder no longer suggests `--trust-directory`, which only covers a single run and so never helped the installed service. It now suggests running `nanocoder` there once, or `NANOCODER_TRUST_DIRECTORY=1 nanocoder daemon start` once, to save trust.
