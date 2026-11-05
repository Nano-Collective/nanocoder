---
'@nanocollective/nanocoder': patch
---

Make language-server discovery asynchronous and de-duplicate executable checks to avoid blocking the startup event loop. Automatic discovery can now be disabled with `nanocoder.lsp.autoDiscover` or `NANOCODER_LSP=off` while explicitly configured servers remain available. Closes #1774.
