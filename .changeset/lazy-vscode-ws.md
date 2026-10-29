---
'@nanocollective/nanocoder': patch
---

Load the `ws` package lazily so the VS Code WebSocket server's dependencies stay out of the startup module graph unless `--vscode` is used. Previously every boot — interactive, `run`, and the daemon — loaded `ws` and its transitive modules even though the server only ever starts in VS Code mode; they are now fetched on first server start, trimming the startup graph. Thanks to @Vishesh-Verma-07. Closes #1821.
