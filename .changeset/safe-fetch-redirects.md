---
"@nanocollective/nanocoder": patch
---

Prevent `fetch_url` from following HTTP redirects before the destination has been validated, protecting the no-approval tool from redirect-based access to private and loopback addresses. Closes #1089.
