---
"@nanocollective/nanocoder": patch
---

Lazy-load `cli-highlight`, `highlight.js` (193 language modules) and `parse5` until syntax highlighting is actually needed. `highlight()` is now wrapped in a synchronous lazy-loader so startup commands like `--version`, idle TUI sessions, and `--plain` runs that never display a fenced code block or file preview no longer pay the startup import and language registration cost. Closes #1776.
