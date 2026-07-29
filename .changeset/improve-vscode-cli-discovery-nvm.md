---
"@nanocollective/nanocoder": patch
---

Fixed an issue where the VS Code extension failed to locate the Nanocoder CLI for users using Node version managers (NVM, Volta, fnm, pnpm, bun). A fallback directory scan is now performed when `which`/`where` cannot resolve the binary under the extension host's minimal PATH. The child-process PATH is also enriched with the CLI's directory only when a co-located `node` binary is present, preventing shadowing of a user's version-manager Node. Thanks to @akramcodez.
