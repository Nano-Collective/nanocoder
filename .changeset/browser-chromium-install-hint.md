---
"@nanocollective/nanocoder": patch
---

When Chromium is missing, the `browser` tool now suggests `npx playwright-core@<version> install chromium` with the bundled version, plus `--with-deps` on Linux. It used to pass through Playwright's own advice to run `npx playwright install`, which fetches the separate `playwright` package at its latest version and can download a Chromium build the bundled `playwright-core` does not launch.
