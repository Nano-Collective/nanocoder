---
"@nanocollective/nanocoder": patch
---

Fixed the VS Code extension's CLI discovery so a foreign project that happens to compile a script to `dist/cli.js` is no longer executed as the Nanocoder CLI. The local development fallback now requires the workspace folder's `package.json` to name `@nanocollective/nanocoder` (#1725); other folders are skipped and discovery continues to the installed CLI.
