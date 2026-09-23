---
"@nanocollective/nanocoder": patch
---

- **`--mouse` and `--no-mouse` are stripped from a `run` prompt.** They were
  documented but not filtered, so `nanocoder run "fix the tests" --mouse` sent
  the model a prompt beginning with the word `--mouse`. Display flags on a
  non-interactive run are meaningless, exactly like the `--alt-screen` pair
  that was already stripped.

- **The `run` prompt parser exists once.** It lived inside `cli.tsx` with a
  hand-written copy in `cli.spec.ts`, and the copy had fallen six flags behind
  the original — `--mode`, `--json`, `--output-format`, `--trust-directory` and
  the alt-screen pair were removed by the parser and left in the prompt by the
  copy, so those tests passed against a parser that is not shipped. No test
  written against a duplicate can notice it has drifted, because it is testing
  the duplicate.

  It moves to `run-prompt-args.ts`, imported by both. The tests now derive
  their cases from the parser's own flag lists rather than a list typed beside
  them, and a second test reads the flags out of `--help` and fails if one is
  documented but not filtered. That second test is what found the `--mouse`
  pair above, which a hand-written enumeration had missed twice.
