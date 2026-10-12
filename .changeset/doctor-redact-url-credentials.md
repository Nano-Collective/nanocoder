---
"@nanocollective/nanocoder": patch
---

Fixed `/doctor` printing provider and MCP server URLs with embedded credentials. The report now passes both URLs through a new `redactUrlForDisplay` helper, which strips userinfo (`https://user:pass@host` becomes `https://***@host`) and blanks sensitive query parameter values, so a pasted report no longer leaks secrets despite the "Secrets are not printed" header.
