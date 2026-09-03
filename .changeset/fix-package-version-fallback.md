---
'@nanocollective/nanocoder': patch
---

Fix a startup crash when `package.json` is missing, unreadable, or malformed. Both module-load reads of the version (`cli.tsx` and the welcome banner) threw before any error handling existed, taking down the CLI on a misbuilt install. Version lookup now lives in a single helper that falls back to `unknown`, shared by the banner, `/help`, and `/doctor` (which previously reported a misleading `0.0.0`).
