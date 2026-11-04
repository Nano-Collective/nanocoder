---
'@nanocollective/nanocoder': patch
---

Fixed `pnpm run build` and `pnpm run build:vscode` failing on native Windows. The build scripts used POSIX-only `mkdir -p`, `cp` and `chmod` commands, which `cmd.exe` cannot run, so the voice plugin output and `contributors.json` were never copied into `dist/` and the VS Code extension's `assets/` folder was never created. The copy and permission steps now live in `scripts/post-build.js`, and the `assets/` folder is created with Node's `fs`, with unchanged behavior on macOS and Linux. A new `Build (Windows)` CI job runs `pnpm run build` on `windows-latest` to prevent regressions.
