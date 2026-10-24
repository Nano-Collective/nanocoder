---
"@nanocollective/nanocoder": patch
---

Fixed `/doctor` printing provider and MCP URLs with embedded credentials. The report promised "Secrets are not printed" while printing userinfo passwords, path tokens, and API keys exactly as configured, so pasting it into a bug report leaked them. URLs are now redacted at the print site. Closes #1661.