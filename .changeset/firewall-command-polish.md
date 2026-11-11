---
"@nanocollective/nanocoder": patch
---

`/firewall` now says in plain words what it does (block or warn about edits that delete tests, change exported signatures, add `any` types or touch protected paths) and lists its `enable` and `disable` shorthands everywhere it lists subcommands, including the unknown-subcommand error. The `/firewall` status view now takes its colours from the active theme instead of fixed terminal greens, reds and yellows.
