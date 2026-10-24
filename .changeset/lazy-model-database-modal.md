---
"@nanocollective/nanocoder": patch
---

The model database modal now loads on first open, keeping its model fetcher and clipboard dependencies out of the startup module graph. Closes #1775.
