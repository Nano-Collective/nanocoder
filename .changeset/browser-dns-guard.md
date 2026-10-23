---
"@nanocollective/nanocoder": patch
---

The `browser` tool now resolves hostnames before loading them, as `fetch_url` does. It only checked the URL text, so a public DNS name that points at a private or cloud metadata address, such as `169.254.169.254.nip.io`, could be opened and screenshotted. Navigation, every page request and redirect landings are now blocked when the name resolves to a private, link-local or metadata address, or does not resolve. Names that resolve to loopback are still allowed, so local dev servers keep working.
