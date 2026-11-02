---
"@nanocollective/nanocoder": patch
---

Shell completions now offer the `review`, `verify` and `skills` subcommands and the `--prompt-file`, `--mouse` and `--no-mouse` options, which the CLI accepted but never tab-completed. A misspelled `verify` such as `nanocoder verfy` now gets a "Did you mean" suggestion too.
