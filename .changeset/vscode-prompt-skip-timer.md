---
"@nanocollective/nanocoder": patch
---

Fixed the VS Code extension install prompt (`--vscode`) calling its "skip" handler after it had already closed. When an install failed, the prompt waited three seconds and then continued even if it had been unmounted in the meantime. The delay is now cancelled on unmount, as it already was for the "no editor CLI found" message.
