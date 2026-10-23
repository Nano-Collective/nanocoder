---
"@nanocollective/nanocoder": patch
---

Typing an option before a subcommand, as in `nanocoder --trust-directory daemon start`, no longer prints the confusing `Unknown command "daemon". Did you mean "daemon"?`. The CLI now says to put the command first and shows the corrected command line, for example `Put "daemon" first: nanocoder daemon start --trust-directory`, and it never suggests the word that was already typed.
