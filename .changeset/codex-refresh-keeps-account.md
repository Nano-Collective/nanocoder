---
'@nanocollective/nanocoder': patch
---

A ChatGPT Codex token refresh keeps the saved account id, and keeps the refresh token when the token endpoint does not send a new one. The session uses the new access token after that, so the next request does not refresh again with the old one. Closes #1632.
