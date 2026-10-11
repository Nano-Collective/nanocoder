---
'@nanocollective/nanocoder': patch
---

Language server crashes are no longer silent. When a server exits unexpectedly, in-flight requests fail immediately instead of hanging until the 30s timeout, the user sees an error with the tail of the server's stderr, stale diagnostics from that server are dropped, and Nanocoder restarts the server once. `lsp_get_diagnostics` now reports the crash instead of returning "no diagnostics". Closes #1515.
