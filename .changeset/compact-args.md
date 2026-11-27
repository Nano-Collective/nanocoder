---
"@nanocollective/nanocoder": patch
---

`/compact` no longer compacts the history when it cannot use an argument. A typo such as `/compact --previw`, an unknown word, or `--threshold` / `--strategy` with no value now shows an error with the usage and leaves the history as it is.
