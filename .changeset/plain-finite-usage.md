---
"@nanocollective/nanocoder": patch
---

Fix `--plain` / `nanocoder run` usage totals turning into `NaN` or `Infinity` when a provider reports a broken token count. A non-finite field is now treated as missing, as the TUI and ACP already did: the `--json` report's `usage` block only counts real numbers, and is left out when a provider reports nothing usable.
