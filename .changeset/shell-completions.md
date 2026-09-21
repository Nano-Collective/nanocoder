---
"@nanocollective/nanocoder": minor
---

Added `nanocoder completion <bash|zsh|fish>`, which prints a self-contained tab-completion script for the requested shell so subcommands, flags, and known flag values (like `--mode normal|auto-accept|yolo|plan`) complete at the shell prompt. The shell argument is required, so a missing or unknown shell fails with usage instead of silently installing the wrong script. Scripts are rendered from a single spec in `source/cli-completions/spec.ts` shared by all three shells, and the command runs on the startup fast path so it costs nothing. Install via `eval "$(nanocoder completion zsh)"` or by piping to your shell's completion directory — see docs/features/shell-completions.md. Closes #1003.
