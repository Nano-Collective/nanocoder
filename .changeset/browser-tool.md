---
'@nanocollective/nanocoder': minor
---

Add a built-in `browser` tool (navigate, click, type, screenshot) on one shared headless Chromium page. Screenshots reach vision models as images. On OpenAI-compatible providers they follow the tool result as an image message. Models that models.dev lists as text-only get the caption without the image. Localhost is allowed. Private network and cloud metadata addresses are blocked. Chromium itself is installed with `npx playwright-core install chromium` (add `--with-deps` on Linux).

Hostnames are resolved before loading, as `fetch_url` does, so a public name that points at a private or metadata address (for example `169.254.169.254.nip.io`) is blocked on navigation, on every page request and after redirects. When Chromium is missing, the error suggests `npx playwright-core@<bundled version> install chromium`. Models that models.dev does not list still get screenshots, but if the provider rejects a request for carrying images, it is retried once without them and later requests in the session leave them out, so a text-only local model cannot get stuck on a screenshot in history.
