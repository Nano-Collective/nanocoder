---
'@nanocollective/nanocoder': patch
---

Provider connection errors now name the provider and `baseUrl` that failed, and say *why*. A refused connection (`ECONNREFUSED`), an unknown host (`ENOTFOUND`), a temporary DNS failure (`EAI_AGAIN`), a reset connection, and a TLS failure each produce their own text instead of the same "Connection failed: Unable to reach the model server". A malformed `baseUrl` — an unset environment variable, a missing `http://`, or a blocked port — is explained as an invalid `baseUrl` with the offending URL and a fix hint, rather than surfacing Node's raw one-word `Invalid URL` / `bad port` / `unknown scheme`. Closes #1742.
