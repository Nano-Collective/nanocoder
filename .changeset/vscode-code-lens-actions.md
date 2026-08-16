---
"@nanocollective/nanocoder": minor
---

Added editor code lenses to the VS Code extension: every function, method, constructor and class now carries `Explain Code` and `Generate Tests` links, and clicking one reveals the chat view and sends that symbol - instruction, `file:startLine-endLine` and the source, fenced with the document language - as a prompt. Symbols come from the language server, so no per-language parsing is involved, and the lenses can be turned off with `nanocoder.codeLens`. Long symbols are capped before being inlined, so a lens click on a large class cannot spend a whole context window on one turn. Also fixes a pre-existing hang where sending a message while a tool approval was still pending left the composer spinning forever. Closes #750.
