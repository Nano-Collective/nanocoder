---
"@nanocollective/nanocoder": minor
---

Added `nanocoder verify --pr <n>` — a headless CLI command that reviews a pull request (diff, CI status, and a semgrep static-analysis pass) via a new read-only `verify-pr-review` subagent, printing a structured Markdown review to stdout by default or posting it as a PR comment with `--post-review`.
