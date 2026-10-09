---
'@nanocollective/nanocoder': minor
---

Add a built-in `browser` tool (navigate, click, type, screenshot) on one shared headless Chromium page. Screenshots reach vision models as images. On OpenAI-compatible providers they follow the tool result as an image message. Models that models.dev lists as text-only get the caption without the image. Localhost is allowed. Private network and cloud metadata addresses are blocked. Chromium itself is installed with `npx playwright install chromium`.
