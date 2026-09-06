---
"@nanocollective/nanocoder": patch
---

Fixed a regression where the VS Code extension webview rendered without theme colors after the Tailwind v4 upgrade by migrating custom color variables to an `@theme` block in the CSS.
