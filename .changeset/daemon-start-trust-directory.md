---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder daemon start --trust-directory` failing with `Unknown flag: "--trust-directory"`. `cli.tsx` already forwarded the flag to the daemon and the help text lists it, but the start parser rejected it. The parser now accepts it, so the flag skips the directory trust check for that start only. It can be combined with `--trust <level>`, which is a separate setting: the CI investigation trust level, unrelated to directory trust.
