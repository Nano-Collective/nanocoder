---
'@nanocollective/nanocoder': patch
---

Fixed `pnpm run build` failing on native Windows. The build script ended with POSIX-only `mkdir -p`, `cp` and `chmod` commands, which `cmd.exe` cannot run, so the voice plugin output and `contributors.json` were never copied into `dist/`. The copy and permission steps now live in `scripts/post-build.js` and use only Node's `fs`, with unchanged behavior on macOS and Linux. A new `Build (Windows)` CI job runs `pnpm run build` on `windows-latest` to prevent regressions.
