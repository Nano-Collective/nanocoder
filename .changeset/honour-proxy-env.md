---
"@nanocollective/nanocoder": minor
---

Provider requests, `fetch_url` and `web_search` now honour `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` (lowercase forms too). With none of the proxy variables set, nothing changes. Per-provider TLS options (`caCertPath`) and timeouts keep applying through the proxy, and `NO_PROXY` hosts such as `localhost` still connect directly. Closes #2171.
