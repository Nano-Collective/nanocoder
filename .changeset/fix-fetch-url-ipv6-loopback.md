---
"@nanocollective/nanocoder": patch
---

Block IPv6 loopback in the `fetch_url` SSRF guard. The validator rejected `127.0.0.1` but let `http://[::1]:8080` through, so the loopback protection could be bypassed over IPv6. It now also rejects `[::1]` (and its expanded/IPv4-mapped spellings) and the `[::]` unspecified address. Closes #734.
