---
"nanocoder-vscode": patch
---

Fixed an issue where the VS Code extension failed to locate the Nanocoder CLI for users using Node version managers (NVM, Volta, fnm) by adding fallback discovery paths and correctly injecting the Node binary path into the spawn environment. Thanks to @akramcodez. Closes #712.
