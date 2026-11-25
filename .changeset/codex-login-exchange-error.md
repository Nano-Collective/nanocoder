---
"@nanocollective/nanocoder": patch
---

The ChatGPT/Codex device login now stops and shows the real error when the token exchange (or saving the credential) fails, instead of polling again with the same one-time code until the 5-minute timeout. Closes #2335.
