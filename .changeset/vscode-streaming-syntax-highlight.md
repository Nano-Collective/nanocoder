---
'@nanocollective/nanocoder': minor
---

The VS Code chat panel now syntax-highlights code blocks as they stream in, and shows a blinking cursor at the end of the text the agent is still writing. Code blocks used to render with no colour at all, while streaming and once finished. They are now highlighted as soon as the fence opens, without waiting for the closing backticks, and a language name that is still being typed (`py`, `pyth`, `python`) falls back to plain text rather than erroring. The colours follow the light or dark VS Code theme. Highlighting uses a small vendored `highlight.js` bundle (16 common languages, the same static-file approach as `marked.min.js`, no new dependency), and the cursor is pure CSS that stops when the turn ends, is cancelled, or a tool call starts. Closes #751.
