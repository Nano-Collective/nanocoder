---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder daemon start --trust-directory` failing with `Unknown flag: "--trust-directory"`. `cli.tsx` already forwarded the flag to the daemon and the help text lists it, but the start parser rejected it. The parser now accepts it alongside `--trust`, so the flag skips the directory trust check for that start only.
